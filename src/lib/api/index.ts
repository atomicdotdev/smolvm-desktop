import { imageApi } from "./image";
import { machineApi } from "./machine";
import { packApi } from "./pack";
import { smolfileApi } from "./smolfile";
import { systemApi } from "./system";

export const api = {
  ...machineApi,
  ...imageApi,
  ...packApi,
  ...smolfileApi,
  ...systemApi,
};
