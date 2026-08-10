import { defineComponents } from "blume";

export default defineComponents({
  layout: {
    Header: "./src/components/Header.astro",
    MobileNav: "./src/components/DocsSidebar.astro",
    Sidebar: "./src/components/DocsSidebar.astro",
  },
});
