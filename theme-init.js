(() => {
  try {
    const theme = localStorage.getItem("teslafield.appearance.v2") || "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
  } catch (error) {
    document.documentElement.classList.add("dark");
  }
})();
