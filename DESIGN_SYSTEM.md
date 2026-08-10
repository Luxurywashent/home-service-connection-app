# Team Luxury Wash - Premium Design System

## Design Philosophy

The redesigned Team Luxury Wash app embraces a **modern, premium aesthetic** inspired by leading rideshare and service apps (Uber, Lyft, DoorDash). The design prioritizes **seamless user experience**, **visual clarity**, and **delightful interactions** that make performance tracking engaging rather than utilitarian.

### Core Principles

**Elegance Through Simplicity** — Remove visual clutter. Every element serves a purpose. Use generous whitespace and clean typography to guide attention naturally.

**Hierarchy Through Color & Scale** — Primary actions use bold accent colors. Secondary actions fade into the background. Text hierarchy is immediately clear through size and weight.

**Smooth Motion** — Transitions and animations feel natural and purposeful. No jarring changes. Micro-interactions provide feedback without distraction.

**Accessibility First** — High contrast ratios, readable fonts, and touch targets that work for all users. Dark mode support built-in from day one.

---

## Color Palette

### Primary Brand Colors

| Color | Hex | Usage | Purpose |
|-------|-----|-------|---------|
| **Luxury Blue** | `#0066FF` | Primary actions, highlights, active states | Main brand color - premium, trustworthy |
| **Accent Gold** | `#FFB800` | Bonuses, achievements, highlights | Luxury feel, celebration moments |
| **Success Green** | `#00B341` | Positive metrics, efficiency ≥80% | Clear positive feedback |
| **Warning Orange** | `#FF9500` | Caution states, efficiency 70-79% | Attention without alarm |
| **Error Red** | `#FF3B30` | Errors, efficiency <70% | Clear negative feedback |

### Neutral Colors

| Color | Hex | Usage |
|-------|-----|-------|
| **Dark Background** | `#0F1419` | Primary background (dark mode) |
| **Light Background** | `#FFFFFF` | Primary background (light mode) |
| **Surface Dark** | `#1A1F26` | Cards, elevated surfaces (dark) |
| **Surface Light** | `#F8F9FA` | Cards, elevated surfaces (light) |
| **Text Primary** | `#FFFFFF` (dark) / `#0F1419` (light) | Main text |
| **Text Secondary** | `#A0A6B0` | Secondary text, labels |
| **Border** | `#2A3038` (dark) / `#E5E7EB` (light) | Dividers, borders |

---

## Typography

### Font Family
- **Primary Font**: Inter (system default on iOS/Android)
- **Fallback**: System UI font stack

### Type Scale

| Size | Weight | Usage | Line Height |
|------|--------|-------|-------------|
| **32px** | 700 (Bold) | Page titles, hero metrics | 1.2 |
| **24px** | 600 (Semibold) | Section headers | 1.3 |
| **18px** | 600 (Semibold) | Card titles | 1.4 |
| **16px** | 500 (Medium) | Body text, button labels | 1.5 |
| **14px** | 400 (Regular) | Secondary text, captions | 1.5 |
| **12px** | 500 (Medium) | Labels, badges | 1.4 |

---

## Component Library

### Buttons

**Primary Button** — Bold, full-width, high contrast
- Background: Luxury Blue (`#0066FF`)
- Text: White, 16px, 600 weight
- Padding: 14px vertical, 16px horizontal
- Border Radius: 12px
- Press State: Scale 0.97, opacity 0.9
- Haptic: Light impact

**Secondary Button** — Outlined, lower emphasis
- Background: Transparent
- Border: 2px Luxury Blue
- Text: Luxury Blue, 16px, 600 weight
- Padding: 12px vertical, 16px horizontal
- Border Radius: 12px
- Press State: Background fills with 10% opacity

**Ghost Button** — Text-only, minimal
- Background: Transparent
- Text: Luxury Blue, 16px, 500 weight
- Press State: Background 5% opacity

### Cards

**Metric Card** — Elevated, minimal shadow
- Background: Surface color
- Border: 1px subtle border
- Padding: 16px
- Border Radius: 16px
- Shadow: 0px 4px 12px rgba(0,0,0,0.08)

**Action Card** — Interactive, hover state
- Same as metric card
- Press State: Scale 0.98, shadow increases
- Haptic: Light impact on press

### Input Fields

**Text Input**
- Background: Surface color
- Border: 1px border, 2px on focus
- Border Radius: 12px
- Padding: 12px 16px
- Text: 16px, 400 weight
- Placeholder: Secondary text color

---

## Navigation Architecture

### Tab Bar Redesign

**Option 1: Minimalist Tab Bar** (Recommended)
- 4 main tabs: Home, Performance, Training, Profile
- Icons only (no labels) for clean aesthetic
- Active tab shows Luxury Blue icon + subtle background
- Inactive tabs show secondary text color
- Height: 64px (including safe area)

**Option 2: Dropdown Menu** (Alternative)
- Hamburger menu in top-right corner
- Slides in from right side
- Full-screen overlay with navigation items
- Smooth animation (200ms)
- Tap outside to close

### Screen Hierarchy

```
Home (Dashboard)
├── Today/Week/All Time view toggle
├── Efficiency hero card
├── Key metrics grid
├── Projected income card
└── Quick actions

Performance (Analytics)
├── Performance trends chart
├── Daily breakdown
├── Weekly comparison
└── Historical data

Training (Learning)
├── Module carousel
├── Progress indicators
├── Completion badges
└── Leaderboard

Profile (Settings)
├── Employee info
├── Preferences
├── Notifications
└── Logout
```

---

## Micro-Interactions

### Press Feedback

**Primary Actions** — Scale + haptic
- Transform: scale(0.97)
- Duration: 80ms
- Haptic: Light impact

**List Items** — Opacity fade
- Opacity: 0.7
- Duration: 100ms
- No haptic

### Loading States

**Skeleton Screens** — Shimmer effect
- Subtle pulse animation
- Matches card layout
- Duration: 1.5s loop

**Progress Indicators** — Smooth fill
- Linear animation
- Duration: 300ms
- Color: Luxury Blue

### Success Animations

**Achievement Unlock** — Bounce + scale
- Initial scale: 0.5
- Final scale: 1.0
- Duration: 400ms
- Easing: Spring (damping: 0.6)
- Haptic: Success notification

---

## Spacing System

| Scale | Value | Usage |
|-------|-------|-------|
| **xs** | 4px | Micro spacing |
| **sm** | 8px | Component padding |
| **md** | 12px | Card padding |
| **lg** | 16px | Section padding |
| **xl** | 24px | Major sections |
| **2xl** | 32px | Screen padding |

---

## Dark Mode

The app uses automatic dark mode detection with manual override option.

**Dark Mode Palette:**
- Background: `#0F1419`
- Surface: `#1A1F26`
- Text Primary: `#FFFFFF`
- Text Secondary: `#A0A6B0`
- Borders: `#2A3038`

**Light Mode Palette:**
- Background: `#FFFFFF`
- Surface: `#F8F9FA`
- Text Primary: `#0F1419`
- Text Secondary: `#6B7280`
- Borders: `#E5E7EB`

---

## Animation Guidelines

### Timing

| Duration | Use Case |
|----------|----------|
| 80ms | Quick feedback (button press) |
| 150ms | Micro-interactions |
| 250ms | Screen transitions |
| 400ms | Complex animations |

### Easing

- **Quick feedback**: `easeOut` (fast start, slow end)
- **Entrances**: `easeInOut` (smooth throughout)
- **Exits**: `easeIn` (slow start, fast end)
- **Playful moments**: `spring` (damping: 0.6)

---

## Visual Effects

### Glassmorphism (Subtle)

Used sparingly on overlay elements:
- Background: Color with 80% opacity
- Backdrop blur: 8px
- Border: 1px with 20% opacity white

### Gradients

**Accent Gradient** — For hero sections
- Start: Luxury Blue (`#0066FF`)
- End: Accent Gold (`#FFB800`)
- Angle: 135°

**Subtle Gradient** — For backgrounds
- Start: Surface color
- End: Surface color + 5% lighter
- Angle: 180°

---

## Responsive Design

The app is designed mobile-first for portrait orientation (9:16).

### Breakpoints

- **Small** (< 375px): Compact spacing, single column
- **Medium** (375-414px): Standard spacing, single column
- **Large** (> 414px): Generous spacing, potential 2-column layouts

---

## Accessibility

### Color Contrast

- Text on background: Minimum 4.5:1 ratio
- Interactive elements: Minimum 3:1 ratio
- All states (hover, focus, active) maintain contrast

### Touch Targets

- Minimum 44x44pt for interactive elements
- 8pt minimum spacing between targets

### Typography

- Minimum font size: 12px
- Maximum line length: 65 characters
- Line height: 1.4-1.6 for body text

---

## Implementation Checklist

- [ ] Update theme.config.js with new color palette
- [ ] Create new component library (buttons, cards, inputs)
- [ ] Redesign dashboard with hero metric card
- [ ] Implement new navigation (tab bar or dropdown)
- [ ] Add smooth animations and transitions
- [ ] Update all screens with new design
- [ ] Test dark mode on all screens
- [ ] Verify accessibility (contrast, touch targets)
- [ ] Performance optimization (animation frame rates)
- [ ] User testing and refinement
