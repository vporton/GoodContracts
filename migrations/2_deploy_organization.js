const { toGD } = require("./helpers");
const settings = require("./deploy-settings.json");
const Identity = artifacts.require("./Identity");
const FeeFormula = artifacts.require("./FeeFormula");
const Controller = artifacts.require("./Controller.sol");
const DaoCreatorGoodDollar = artifacts.require("./DaoCreatorGoodDollar.sol");
const ControllerCreatorGoodDollar = artifacts.require(
  "./ControllerCreatorGoodDollar.sol"
);
const AddFoundersGoodDollar = artifacts.require("./AddFoundersGoodDollar");
const GoodDollar = artifacts.require("./GoodDollar.sol");
const Reputation = artifacts.require("./Reputation.sol");

const Avatar = artifacts.require("./Avatar.sol");
const AbsoluteVote = artifacts.require("./AbsoluteVote.sol");
const SchemeRegistrar = artifacts.require("./SchemeRegistrar.sol");
const UpgradeScheme = artifacts.require("./UpgradeScheme.sol");

const AdminWallet = artifacts.require("./AdminWallet.sol");

const releaser = require("../scripts/releaser.js");
const getFounders = require("./getFounders");

const tokenName = "GoodDollar";
const tokenSymbol = "G$";

// initial preliminary constants
const votePrecedence = 50;
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const NULL_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

// AdminWallet Settings

module.exports = async function (deployer, network) {
  const isMainNet = network.indexOf("mainnet") >= 0;
  const networkEnv = network.replace(/-?mainnet/, "");
  const networkSettings = { ...settings["default"], ...settings[networkEnv] };
  const walletToppingAmount = web3.utils.toWei(
    networkSettings.walletToppingAmount,
    networkSettings.walletToppingUnits
  );
  const walletToppingTimes = networkSettings.walletToppingTimes;
  const cap = toGD(networkSettings.cap);

  const initRep = networkSettings.reputation;
  let initToken = toGD(networkSettings.avatarTokens);

  const initTokenInWei = initToken;
  const founders = await getFounders(AbsoluteVote.web3, network);

  console.log({ founders, acc: await web3.eth.getAccounts() });

  const identity = await deployer.deploy(Identity);

  console.log("deployed identity, starting  org deploy");

  console.log("setting authentication period");
  await identity.setAuthenticationPeriod(networkSettings.identityAuthenticationPeriod);

  const initRepInWei = Array(founders.length).fill(initRep);

  console.log("deploying feeformula");
  const feeFormula = await deployer.deploy(FeeFormula, networkSettings.txFeePercentage);
  console.log("deploying ControllerCreator");
  const controllerCreator = await deployer.deploy(ControllerCreatorGoodDollar, {
    gas: isMainNet ? 4000000 : undefined
  });

  console.log("Adding founders");

  const addFoundersGoodDollar = await deployer.deploy(
    AddFoundersGoodDollar,
    controllerCreator.address
  );

  console.log("deploying daocreator");
  const daoCreator = await deployer.deploy(
    DaoCreatorGoodDollar,
    addFoundersGoodDollar.address,
    { gas: isMainNet ? 8000000 : undefined }
  );

  console.log({
    tokenName,
    tokenSymbol,
    cap,
    formula: feeFormula.address,
    identity: identity.address,
    founders,
    initTokenInWei,
    initRepInWei
  });

  console.log("forgeorg");
  await daoCreator.forgeOrg(
    tokenName,
    tokenSymbol,
    cap,
    feeFormula.address,
    identity.address,
    founders,
    initTokenInWei,
    initRepInWei,
    { gas: isMainNet ? 8000000 : undefined }
  );

  const avatar = await Avatar.at(await daoCreator.avatar());
  const controller = await Controller.at(await avatar.owner());
  const token = await GoodDollar.at(await avatar.nativeToken());

  let adminWalletP = Promise.resolve({});
  if (isMainNet) {
    console.log("Skipping AdminWallet for mainnet");
  } else {
    console.log("adminwallet");
    adminWalletP = deployer.deploy(
      AdminWallet,
      [],
      walletToppingAmount,
      walletToppingTimes,
      identity.address
    );
  }
  // Deploy admin wallet

  //Set avatar for schemes
  console.log("setting newly created avatar");
  const [adminWallet, ,] = await Promise.all([
    adminWalletP,
    identity.setAvatar(avatar.address),
    feeFormula.setAvatar(avatar.address)
  ]);

  //for testing we give founders some tokens
  if (
    initTokenInWei != "0" &&
    ["test", "develop", "coverage", "soliditycoverage"].includes(network)
  ) {
    await Promise.all(founders.map(f => token.mint(f, initTokenInWei)));
  }

  console.log("setting identity");
  await Promise.all([
    identity.addIdentityAdmin(avatar.address),
    identity.addPauser(avatar.address),
    adminWallet.address && identity.addIdentityAdmin(adminWallet.address)
  ]);
  console.log("transfering ownerships");

  await Promise.all([
    identity.transferOwnership(await avatar.address /* owner */),
    feeFormula.transferOwnership(await avatar.address /* .owner() */)
  ]);

  if (network.indexOf("production") >= 0) {
    await token.renounceMinter(); // TODO: renounce all founders
  }

  console.log("setting up dao voting machine and schemes");

  // Schemes
  // Deploy Voting Matching
  const [absoluteVote, upgradeScheme, schemeRegistrar] = await Promise.all([
    deployer.deploy(AbsoluteVote),
    deployer.deploy(UpgradeScheme),
    deployer.deploy(SchemeRegistrar)
  ]);
  console.log("setting parameters");
  const voteParametersHash = await absoluteVote.getParametersHash(
    votePrecedence,
    NULL_ADDRESS
  );

  console.log("setting params for voting machine and schemes");

  await Promise.all([
    schemeRegistrar.setParameters(
      voteParametersHash,
      voteParametersHash,
      absoluteVote.address
    ),
    absoluteVote.setParameters(votePrecedence, NULL_ADDRESS),
    upgradeScheme.setParameters(voteParametersHash, absoluteVote.address)
  ]);
  const upgradeParametersHash = await upgradeScheme.getParametersHash(
    voteParametersHash,
    absoluteVote.address
  );

  // Deploy SchemeRegistrar
  const schemeRegisterParams = await schemeRegistrar.getParametersHash(
    voteParametersHash,
    voteParametersHash,
    absoluteVote.address
  );

  let schemesArray;
  let paramsArray;
  let permissionArray;

  // Subscribe schemes
  schemesArray = [
    schemeRegistrar.address,
    upgradeScheme.address,
    identity.address,
    feeFormula.address
  ];
  paramsArray = [schemeRegisterParams, upgradeParametersHash, NULL_HASH, NULL_HASH];
  permissionArray = ["0x0000001F", "0x0000001F", "0x0000001F", "0x0000001F"];

  console.log("setting schemes");
  await daoCreator.setSchemes(
    avatar.address,
    schemesArray,
    paramsArray,
    permissionArray,
    "metaData"
  );

  console.log("whitelisting contracts and founders...");
  await Promise.all([
    ...founders.map(
      async f => (await identity.isWhitelisted(f)) === false && identity.addWhitelisted(f)
    ),
    identity.addContract(avatar.address),
    identity.addContract(await avatar.owner()),
    adminWallet.address && identity.addContract(adminWallet.address),
    identity.addContract(identity.address)
  ]);

  let releasedContracts = {
    GoodDollar: await avatar.nativeToken(),
    Reputation: await avatar.nativeReputation(),
    Identity: await identity.address,
    Avatar: await avatar.address,
    Controller: await avatar.owner(),
    AbsoluteVote: await absoluteVote.address,
    SchemeRegistrar: await schemeRegistrar.address,
    UpgradeScheme: await upgradeScheme.address,
    AdminWallet: await adminWallet.address,
    UBI: NULL_ADDRESS,
    SignupBonus: NULL_ADDRESS,
    OneTimePayments: NULL_ADDRESS,
    HomeBridge: NULL_ADDRESS,
    ForeignBridge: NULL_ADDRESS,
    network,
    networkId: parseInt(deployer.network_id)
  };

  console.log("Writing deployment file...\n", { releasedContracts });
  await releaser(releasedContracts, network);
};
