import { DomainError } from "@/modules/projects/errors";

export type Sub2ApiConnectionAddress = {
  baseUrl: string;
  sourceOrigin: string;
};

export function resolveSub2ApiConnectionAddress(
  incoming: Sub2ApiConnectionAddress | null,
  current: Sub2ApiConnectionAddress | null,
) {
  const address = incoming ?? current;
  if (!address) {
    throw new DomainError(
      "SUB2API_URL_REQUIRED",
      "首次配置必须填写 Sub2API 地址",
      422,
    );
  }
  return address;
}
