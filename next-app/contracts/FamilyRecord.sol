// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FamilyRecord {
    /// @notice 家族 ID => 当前 IPFS 数据哈希
    mapping(bytes32 => string) public familyDataHash;

    /// @notice 家族数据保存/更新事件
    event FamilySaved(bytes32 indexed familyId, string dataHash);

    /// @notice 保存或更新指定家族的 IPFS 数据哈希
    /// @param familyId 家族的唯一标识符（bytes32）
    /// @param dataHash 族谱数据在 IPFS 上的 CID 哈希
    function saveFamilyData(bytes32 familyId, string calldata dataHash) external {
        familyDataHash[familyId] = dataHash;
        emit FamilySaved(familyId, dataHash);
    }
}