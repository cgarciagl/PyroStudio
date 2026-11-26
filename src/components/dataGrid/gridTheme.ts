/**
 * Pyro theme for the Glide Data Grid canvas (light / dark). Canvas drawing
 * cannot read CSS variables, so the palette is resolved here.
 */
export function buildGridTheme(
  isLight: boolean,
  activeFont: string,
  cellVerticalPadding: number,
  fontSize = 12,
) {
  return {
  accentColor: "#ff5c16",
  accentLight: isLight ? "rgba(255, 92, 22, 0.12)" : "rgba(255, 92, 22, 0.15)",
  // Faint cool tint so the grid reads as its own surface in both themes
  // Kept in step with the --pyro-* surfaces in App.css (softened dark/light).
  bgCell: isLight ? "#f7f8fa" : "#1b1e24",
  bgCellMedium: isLight ? "#eef0f3" : "#20242b",
  bgHeader: isLight ? "#e8ebef" : "#22262e",
  bgHeaderHasFocus: isLight ? "#dce1e7" : "#2d323c",
  bgHeaderHovered: isLight ? "#e1e5ea" : "#292d36",
  textDark: isLight ? "#111827" : "#e2e5ea",
  textMedium: isLight ? "#4b5563" : "#aab1bd",
  textLight: isLight ? "#7b8494" : "#7d8593",
  textHeader: isLight ? "#1f2937" : "#eef0f3",
  textHeaderSelected: isLight ? "#111827" : "#ffffff",
  borderColor: isLight ? "#d9dde4" : "#2e333d",
  drilldownBorder: isLight ? "#c3cad4" : "#3c424e",
  lineHeight: 1.4,
  fontFamily: activeFont,
  baseFontStyle: `${fontSize}px ${activeFont}`,
  headerFontStyle: `600 ${fontSize}px ${activeFont}`,
  editorFontSize: `${fontSize}px`,
  cellVerticalPadding: cellVerticalPadding,
  cellHorizontalPadding: 8,
  };
}
