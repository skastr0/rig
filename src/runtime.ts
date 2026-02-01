import { ManagedRuntime } from "effect";
import { AppLayer } from "./services/AppLayer.js";

export const AppRuntime = ManagedRuntime.make(AppLayer);
