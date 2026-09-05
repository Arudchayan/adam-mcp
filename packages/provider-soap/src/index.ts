import { AdamError, type AdamProvider } from "adam-core";

const UNAVAILABLE = new AdamError(
  "provider_unavailable",
  "The SOAP provider is disabled. Unauthenticated GET https://adam.unibas.ch/soap/server.php returns Apache HTTP 403 and no WSDL. SOAP login is a local password, not SWITCH edu-ID.",
);

function disabled(): never {
  throw UNAVAILABLE;
}

export class SoapAdamProvider implements AdamProvider {
  readonly id = "soap" as const;

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

export function createSoapProvider(): SoapAdamProvider {
  return new SoapAdamProvider();
}
