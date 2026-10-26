# Rove Stopwatch

A simple, elegant stopwatch application built with Tauri and vanilla JavaScript.

## Features

- **Digital Stopwatch**: Displays time in hours, minutes, and seconds counting up
- **Interactive Controls**:
  - **Left Click**: Start/stop the stopwatch
  - **Right Click**: Opens context menu with reset and format options
- **Display Formats**:
  - `hh:mm:ss` - Traditional time format
  - `hh.hh` - Decimal hours format
- **Visual Feedback**:
  - Pink background when stopped
  - Light green background when running
- **Persistent State**: Remembers start time and settings even after closing the app or shutting down the computer
- **Non-resizable Window**: Fixed size for consistent user experience

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [Rust](https://www.rust-lang.org/tools/install)

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

## Development

Run the application in development mode:

```bash
npm run tauri dev
```

## Building

Build the application for production:

```bash
npm run tauri build
```

The built application will be available in `src-tauri/target/release/bundle/`

## Project Structure

```
Stopwatch/
├── index.html          # Main HTML file
├── styles.css          # Styling
├── main.js            # Frontend JavaScript logic
├── package.json       # Node.js dependencies
├── src-tauri/         # Tauri/Rust backend
│   ├── src/
│   │   └── main.rs    # Rust backend with state persistence
│   ├── Cargo.toml     # Rust dependencies
│   ├── tauri.conf.json # Tauri configuration
│   └── icons/         # Application icons
└── .github/
    └── copilot-instructions.md
```

## Usage

- **Start/Stop**: Click anywhere on the stopwatch face
- **Reset**: Right-click and select "Reset" from the menu
- **Change Format**: Right-click and select "Switch to hh.hh" or "Switch to hh:mm:ss"

## Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Rust with Tauri framework
- **State Management**: Tauri Store plugin for persistent storage

## License

MIT
