import {
  auditActionLabel,
  auditResourceLabel,
  auditResultLabel,
} from "@/modules/audit/audit-labels";
import { auditCategoryOptions } from "@/modules/audit/audit-presentation";
import type { AuditFacets } from "@/modules/audit/audit-types";

/**
 * 把服务层的 facets 补上中文标签。
 *
 * 三个原始字符串数组必须保持不变：滚动发布期间旧 Web bundle 仍按字符串消费。
 * 中文下拉另起 `*Options`，小程序也复用这套。
 */
export function buildAuditFacetOptions(facets: AuditFacets) {
  return {
    ...facets,
    actionOptions: facets.actions.map((value) => ({
      value,
      label: auditActionLabel(value),
    })),
    resourceTypeOptions: facets.resourceTypes.map((value) => ({
      value,
      label: auditResourceLabel(value),
    })),
    // FAILURE 与 FAILED 在展示上都是「失败」，合并成一个筛选项；
    // 查询层会把 FAILURE 展开成两种结果值。
    resultOptions: (() => {
      const seen = new Set<string>();
      const options: Array<{ value: string; label: string }> = [];
      for (const value of facets.results) {
        const key = value === "FAILED" ? "FAILURE" : value;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ value: key, label: auditResultLabel(key) });
      }
      const order = ["SUCCESS", "FAILURE", "DENIED"];
      return options.sort(
        (left, right) =>
          (order.indexOf(left.value) + 1 || 99) -
          (order.indexOf(right.value) + 1 || 99),
      );
    })(),
    categoryOptions: auditCategoryOptions,
    actors: facets.actors ?? [],
  };
}
