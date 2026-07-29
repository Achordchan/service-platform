CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

ALTER TABLE "User"
ADD COLUMN "themePreference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM';
