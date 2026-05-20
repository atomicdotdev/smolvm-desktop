import { imageApi } from "./image";
import { machineApi } from "./machine";
import { packApi } from "./pack";
import { systemApi } from "./system";

export const api = {
  ...machineApi,
  ...imageApi,
  ...packApi,
  ...systemApi,
};
