// REFERENCE ONLY. Prototype with known bugs, do not copy as-is:
// division by zero when duration < interval, uneven vesting when duration is not a multiple of the interval,
// unchecked token.transfer, no funding check, no zero-address validation, typos (benficiary), floating pragma.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
}

contract TokenVesting {
    IERC20 public token;
    address public benficiary;
    uint256 public cliff;
    uint256 public start;
    uint256 public duration;
    uint256 public interval;
    uint256 public totalAmount;
    uint256 public released;

    constructor(
        IERC20 _token,
        address _benficiary,
        uint256 _start,
        uint256 _cliffDurationInMonths,
        uint256 _totalVestingDurationInMonths,
        uint256 _amount
    ) {
        require(_cliffDurationInMonths <= _totalVestingDurationInMonths, "cliff duration execed");
        require(_totalVestingDurationInMonths > 0, "duration must be postitive ");
        require(_amount > 0, "amount must be greater than 0");

        token = _token;
        benficiary = _benficiary;
        duration = _totalVestingDurationInMonths * 30 days;
        cliff = _start + (_cliffDurationInMonths * 30 days);
        start = _start;
        interval = 90 days;
        totalAmount = _amount;
    }

    function release() public {
        require(block.timestamp >= cliff, "cliff period is not finshed yet");
        uint256 unreleased = releasableAmount();
        require(unreleased > 0, "no tokens are due for release");

        released += unreleased;
        token.transfer(benficiary, unreleased);
    }

    function releasableAmount() public view returns (uint256) {
        return vestedAmount() - released;
    }

    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) {
            return 0;
        } else if (block.timestamp >= start + duration) {
            return totalAmount;
        } else {
            uint256 timeFromStart = block.timestamp - start;
            uint256 totalIntervals = timeFromStart / interval;
            uint256 totalVestingIntervals = duration / interval;
            return (totalAmount * totalIntervals) / totalVestingIntervals;
        }
    }
}
