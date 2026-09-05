export const CHROME_LAUNCH_POLICY = {
  acceptDownloads: false,
  remoteDebuggingPort: 0,
  remoteDebuggingAddress: "127.0.0.1",
} as const;

export type CancelableDownload = {
  cancel(): Promise<unknown> | unknown;
};

export type DownloadEmitter = {
  on(event: "download", listener: (download: CancelableDownload) => void): unknown;
};

export function attachDownloadGuard(emitter: DownloadEmitter): void {
  emitter.on("download", (download) => {
    void Promise.resolve(download.cancel()).catch(() => undefined);
  });
}

export function chromeLaunchArgs(): string[] {
  return [
    `--remote-debugging-port=${CHROME_LAUNCH_POLICY.remoteDebuggingPort}`,
    `--remote-debugging-address=${CHROME_LAUNCH_POLICY.remoteDebuggingAddress}`,
  ];
}
