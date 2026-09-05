import { AdamError, type AdamProvider } from "adam-core";

const UNAVAILABLE = new AdamError(
  "provider_unavailable",
  "The HTML provider is disabled. It is a last-resort, rate-limited fallback and must not scrape ADAM from v1.",
);

function disabled(): never {
  throw UNAVAILABLE;
}

export class HtmlAdamProvider implements AdamProvider {
  readonly id = "html" as const;
  async listCourses() {
    return disabled();
  }
  async getCourse() {
    return disabled();
  }
  async listChildren() {
    return disabled();
  }
  async readPage() {
    return disabled();
  }
  async listFiles() {
    return disabled();
  }
  async getFile() {
    return disabled();
  }
  async extractFileText(_refId: string, _options?: { maxPages?: number }) {
    return disabled();
  }
  async getExercise(_refId: string) {
    return disabled();
  }
  async search() {
    return disabled();
  }
  async listCalendar() {
    return disabled();
  }
  async listNews() {
    return disabled();
  }
}

export function createHtmlProvider(): HtmlAdamProvider {
  return new HtmlAdamProvider();
}
