/**
 * Pyro theme for the Glide Data Grid canvas (light / dark). Canvas drawing
 * cannot read CSS variables, so the palette is resolved here.
 */
export function buildGridTheme(isLight: boolean, activeFont: string, cellVerticalPadding: number) {
  return {
  accentColor: "#ff5c16",
  accentLight: isLight ? "rgba(255, 92, 22, 0.12)" : "rgba(255, 92, 22, 0.15)",
  // Faint cool tint so the grid reads as its own surface in both themes
  bgCell: isLight ? "#f6f8fc" : "#0e131c",
  bgCellMedium: isLight ? "#eef2f8" : "#121824",
  bgHeader: isLight ? "#f1f5f9" : "#131722",
  bgHeaderHasFocus: isLight ? "#e2e8f0" : "#1a202d",
  bgHeaderHovered: isLight ? "#e8edf5" : "#181d29",
  textDark: isLight ? "#0f172a" : "#e2e8f0",
  textMedium: isLight ? "#475569" : "#94a3b8",
  textLight: isLight ? "#94a3b8" : "#64748b",
  textHeader: isLight ? "#1e293b" : "#f1f5f9",
  textHeaderSelected: isLight ? "#0f172a" : "#ffffff",
  borderColor: isLight ? "#e2e8f0" : "#1e2434",
  drilldownBorder: isLight ? "#cbd5e1" : "#2a3246",
  lineHeight: 1.4,
  fontFamily: activeFont,
  baseFontStyle: `12px ${activeFont}`,
  headerFontStyle: `600 12px ${activeFont}`,
  editorFontSize: "12px",
  cellVerticalPadding: cellVerticalPadding,
  cellHorizontalPadding: 8,
  };
}
