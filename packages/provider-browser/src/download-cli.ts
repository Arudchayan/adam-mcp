import { AdamError, parseAdamRef } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import type { LocalDownload } from "./local-download.ts";

type Downloader = {
  downloadFile(refId: string, directory: string, options?: { signal?: AbortSignal }): Promise<LocalDownload>;
  close(): Promise<void>;
};

export function parseDownloadArgs(argv: string[]): { refId: string; directory: string } {
  const ref = argv[0] ? parseAdamRef(argv[0]) : undefined;
  if (!ref || (ref.type !== "file" && ref.type !== "unknown") || (ref.type === "unknown" && !/^\d+$/.test(argv[0]))) {
    throw new AdamError("unsupported_type", "Select a file ID or canonical https://adam.unibas.ch/go/file/ID URL from adam_list_files.", false);
  }
  let directory: string | undefined;
  let confirmed = false;
  for (let index = 1; index < argv.length; index++) {
    if (argv[index] === "--confirm" && !confirmed) confirmed = true;
    else if (argv[index] === "--output-dir" && directory === undefined && argv[index + 1] && !argv[index + 1].startsWith("--")) directory = argv[++index];
    else throw new AdamError("unsupported_type", "Use download FILE_ID --output-dir DIRECTORY --confirm. Unknown, duplicate or missing option.", false);
  }
  if (!directory) throw new AdamError("unsupported_type", "Specify --output-dir with an existing directory outside a Git checkout.", false);
  if (!confirmed) throw new AdamError("confirmation_required", "Downloading saves the selected course file locally. Add --confirm after choosing that file and destination.", false);
  return { refId: ref.refId, directory };
}

export async function runDownloadCli(
  argv: string[],
  createDownloader: () => Downloader = () => createBrowserProvider(),
): Promise<void> {
  const { refId, directory } = parseDownloadArgs(argv);
  const provider = createDownloader();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    console.error("Downloading the selected file to your local directory. Press Ctrl+C to cancel.");
    const result = await provider.downloadFile(refId, directory, { signal: controller.signal });
    console.log(JSON.stringify(result));
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await provider.close();
  }
}
