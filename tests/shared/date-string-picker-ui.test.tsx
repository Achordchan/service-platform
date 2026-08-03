// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { zhCN as datePickerZhCN } from "@mui/x-date-pickers/locales";
import { zhCN as dateFnsZhCN } from "date-fns/locale/zh-CN";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateStringPicker } from "@/components/shared/date-string-picker";
import { appTheme } from "@/theme/theme";

afterEach(cleanup);

describe("DateStringPicker", () => {
  it("renders the localized MUI field while preserving the form value", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ThemeProvider theme={appTheme}>
        <LocalizationProvider
          dateAdapter={AdapterDateFns}
          adapterLocale={dateFnsZhCN}
          localeText={
            datePickerZhCN.components.MuiLocalizationProvider.defaultProps
              .localeText
          }
        >
          <DateStringPicker
            label="开始日期"
            name="startDate"
            value="2026-07-31"
            onChange={onChange}
          />
        </LocalizationProvider>
      </ThemeProvider>,
    );

    expect(screen.getByRole("group", { name: "开始日期" })).toBeTruthy();
    const formInput = container.querySelector<HTMLInputElement>(
      'input[name="startDate"]',
    );
    expect(formInput?.value).toBe("2026-07-31");
    fireEvent.click(screen.getByRole("button", { name: /选择日期/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("grid", { name: "七月 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "上个月" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "下个月" })).toBeTruthy();

    fireEvent.click(screen.getByRole("gridcell", { name: "30" }));
    expect(onChange).toHaveBeenCalledWith("2026-07-30");
  });
});
