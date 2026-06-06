declare module "web3.storage" {
  export class Web3Storage {
    constructor(options: { token: string; endpoint?: URL });
    put(
      files: Iterable<Filelike>,
      options?: PutOptions
    ): Promise<string>;
    get(cid: string, options?: RequestOptions): Promise<Web3Response | null>;
    status(cid: string, options?: RequestOptions): Promise<Status | undefined>;
    list(opts?: ListOptions): AsyncIterable<Upload>;
    delete(cid: string, options?: RequestOptions): Promise<void>;
  }

  export class File {
    constructor(
      parts: BlobPart[],
      name: string,
      options?: FilePropertyBag
    );
  }

  export class Blob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag);
  }

  export function getFilesFromPath(
    path: string,
    options?: { path?: string; hidden?: boolean }
  ): Promise<File[]>;

  export function filesFromPath(
    path: string,
    options?: { path?: string; hidden?: boolean }
  ): AsyncIterable<File>;

  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Filelike {
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stream: () => any;
  }

  interface PutOptions {
    onRootCidReady?: (cid: string) => void;
    onStoredChunk?: (size: number) => void;
    maxRetries?: number;
    maxChunkSize?: number;
    wrapWithDirectory?: boolean;
    name?: string;
    signal?: AbortSignal;
  }

  interface RequestOptions {
    signal?: AbortSignal;
  }

  interface Status {
    cid: string;
    deals: Deal[];
    pins: Pin[];
    created: string;
  }

  interface Deal {
    dealId: number;
    storageProvider: string;
    status: string;
    pieceCid: string;
    dataCid: string;
    dataModelSelector: string;
    activation: string;
    expiration: string;
    created: string;
    updated: string;
  }

  interface Pin {
    peerId: string;
    peerName: string;
    region: string;
    status: string;
    updated: string;
  }

  interface Upload {
    cid: string;
    created: string;
    deals: Deal[];
    pins: Pin[];
  }

  interface ListOptions {
    before?: string;
    maxResults?: number;
    signal?: AbortSignal;
  }

  interface Web3Response extends Response {
    unixFsIterator(): AsyncGenerator<UnixFSEntry>;
    files(): Promise<Web3File[]>;
  }

  interface UnixFSEntry {
    name: string;
    path: string;
    cid: string;
    content: () => AsyncGenerator<Uint8Array>;
    type: "file" | "directory";
  }

  interface Web3File extends File {
    cid: string;
  }
}