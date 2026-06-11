export interface MemberMemory {
  id: string;
  content: string;
  author: string;
  createdAt: string;
  approved: boolean;
}

export interface Member {
  id: string;
  name: string;
  /** 性别：男 / 女 */
  gender?: "男" | "女";
  birth?: string;
  death?: string;
  info?: string;
  /** 家族故事（可选） */
  story?: string;
  parentId?: string | null;
  spouseOf?: string | null;
  createdAt?: string;
  /** 父亲 ID */
  fatherId?: string;
  /** 母亲 ID */
  motherId?: string;
  /** 配偶 ID */
  spouseId?: string;
  /** 子女 ID 列表（双向同步用） */
  childrenIds?: string[];
  /** 原版照片 IPFS CID */
  photoOriginal?: string;
  /** AI 修复版照片 IPFS CID */
  photoRestored?: string;
  /** 安葬地 */
  burialPlace?: string;
  updatedAt?: string;
  /** 安葬地坐标（纬度,经度） */
  burialCoords?: string;
  /** 家人回忆 */
  memories?: MemberMemory[];
}

/** 家族大事 */
export interface FamilyEvent {
  id: string;
  year: string;
  title: string;
  description: string;
}

/** 家族相册照片条目 */
export interface AlbumPhoto {
  cid: string;
  caption: string;
  time: string;
  location: string;
  people: string;
  uploadedAt: string;
}

export interface FamilyTree {
  familyName: string;
  members: Member[];
  version: string;
  createdAt: string;
  updatedAt: string;
  /** 是否允许被搜索 / 公开显示 */
  searchable?: boolean;
  /** 家族大事列表 */
  familyEvents?: FamilyEvent[];
  /** 家族相册 */
  album?: AlbumPhoto[];
  /** 创建者邮箱哈希 */
  creatorEmailHash?: string;
  /** 受邀编辑者邮箱哈希列表 */
  editors?: string[];
}
