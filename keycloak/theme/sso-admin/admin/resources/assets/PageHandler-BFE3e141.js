// Use native routing for the Heartbeat tab; preserve the handler for every other extension.
import { createElement as h } from "react";
import { P as OriginalPageHandler } from "./PageHandler-original.js";
import { HeartbeatSettings } from "./HeartbeatSettings.js";

export function P(props) {
  return props.page.id === "Heartbeat" ? h(HeartbeatSettings) : h(OriginalPageHandler, props);
}
