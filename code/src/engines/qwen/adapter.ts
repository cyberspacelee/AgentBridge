import type { Config } from "../../config.js";
import { GrokAdapter } from "../grok/adapter.js";

export class QwenAdapter extends GrokAdapter {
  constructor(config: Config) {
    super(config, "qwen");
  }
}
