pragma solidity >0.5.4;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "@daostack/arc/contracts/controller/Avatar.sol";

import "./SchemeGuard.sol";

/**
 * @title Fee formula abstract contract
 */
contract AbstractFees is SchemeGuard {
    constructor() public SchemeGuard(Avatar(0)) {}

    function getTxFees(
        uint256 _value,
        address _sender,
        address _recipient
    ) public view returns (uint256, bool);
}

/**
 * @title Fee formula contract
 * contract that provides a function to calculate
 * fees as a percentage of any given value
 */
contract FeeFormula is AbstractFees {
    using SafeMath for uint256;

    uint256 public percentage;
    bool public constant senderPays = false;

    /**
     * @dev Constructor. Requires the given percentage parameter
     * to be less than 100.
     * @param _percentage the percentage to calculate fees of
     */
    constructor(uint256 _percentage) public {
        require(_percentage < 100, "Percentage should be <100");
        percentage = _percentage;
    }

    /**  @dev calculates the fee of given value.
     * @param _value the value of the transaction to calculate fees from
     * @param _sender address sending.
     *  @param _recipient address receiving.
     * @return the transactional fee for given value
     */
    function getTxFees(
        uint256 _value,
        address _sender,
        address _recipient
    ) public view returns (uint256, bool) {
        return (_value.mul(percentage).div(100), senderPays);
    }
}
