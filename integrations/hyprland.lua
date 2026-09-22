-- Hyprland >= 0.55 / Omarchy. Load after the default window rules.
hl.window_rule({
  name = "snapper-overlay",
  match = { title = "^Snapper Overlay.*$" },
  float = true,
  pin = true,
  no_initial_focus = true,
  border_size = 0,
  rounding = 0,
  opacity = "1.0 1.0",
})
