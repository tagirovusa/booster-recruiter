// Merges the English catalogs of every area. Areas never share a file, so
// each part of the interface owns its own translations.
import * as shell from "./shell";
import * as campaign from "./campaign";
import * as outreach from "./outreach";
import * as backend from "./backend";

const parts = [shell, campaign, outreach, backend];
export const en = Object.assign({}, ...parts.map((p) => p.strings));
export const enTemplates = Object.assign({}, ...parts.map((p) => p.templates));
