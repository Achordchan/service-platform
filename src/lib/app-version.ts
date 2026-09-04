import "server-only";

import pkg from "../../package.json";

/** 平台版本号：取自 package.json（与发布构建同源），随反馈附带给排查定位。 */
export const APP_VERSION: string = pkg.version;
