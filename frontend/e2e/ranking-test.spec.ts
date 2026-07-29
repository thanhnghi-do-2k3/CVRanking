import { expect, test } from "@playwright/test";
import path from "node:path";

test("HR workspace creates a JD, stores CVs under it, previews a CV, and ranks that JD", async ({
  page,
}) => {
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Hiring Intelligence Workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Danh sách vị trí tuyển dụng" })).toBeVisible();
  await page.getByRole("link", { name: "Tạo JD mới" }).click();

  await expect(page.getByRole("heading", { name: "Tạo JD tuyển dụng" })).toBeVisible();
  await page.getByRole("button", { name: "Lưu JD và mở kho CV" }).click();

  await expect(page.getByRole("heading", { name: "Kho CV của Senior Backend Engineer" })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Tools" }).click();
  await expect(page.getByLabel("Chọn JD")).toContainText("Senior Backend Engineer");
  await page.locator("#cv-files").setInputFiles([
    path.resolve("public/ranking-fixtures/cvs/01-alex-strong-backend.pdf"),
    path.resolve("public/ranking-fixtures/cvs/02-binh-mid-backend.pdf"),
    path.resolve("public/ranking-fixtures/cvs/04-dana-devops.pdf"),
    path.resolve("public/ranking-fixtures/cvs/03-chris-frontend.pdf"),
  ]);
  await page.getByRole("button", { name: "Lưu CV vào JD đã chọn" }).click();
  await expect(page.locator(".hr-cv-storage")).toContainText("01-alex-strong-backend.pdf");

  await page.getByRole("button", { name: "Preview" }).first().click();
  await expect(page.getByRole("dialog", { name: /Preview/ })).toContainText("Alex Nguyen");
  await page.getByRole("button", { name: "Đóng preview CV" }).click();

  await page.getByRole("button", { name: "Chạy ranking" }).click();

  await expect(page.locator(".hr-result-row").first()).toContainText("Alex Nguyen", {
    timeout: 20_000,
  });
  await expect(page.locator(".hr-result-row").first()).toContainText("Đáp ứng Go");
  await expect(page.locator(".hr-result-row")).toHaveCount(4);

  await page.getByRole("link", { name: "Vị trí tuyển dụng" }).click();
  await expect(page.locator(".hr-library-job").first()).toContainText("Senior Backend Engineer");
  await expect(page.locator(".hr-library-job").first()).toContainText("Alex Nguyen");
  await expect(page.locator(".hr-library-job").first()).toContainText("4 CV thuộc JD");
});
