# Stage JSON Editor

Browser-based editor for Unity `ManualFloodColor` stage JSON files.

Public Pages URL when this is pushed to a public repository named `stage-json-editor`:

```text
https://s-hany.github.io/stage-json-editor/
```

The app exports JSON in this format:

```json
{
  "gridSize": 5,
  "initial": [
    { "cells": ["W", "W", "R", "X", "X"] }
  ],
  "target": [
    { "cells": ["G", "G", "R", "X", "X"] }
  ]
}
```

Cell symbols:

- `W`: white
- `R`: red
- `G`: green
- `B`: blue
- `X`: blocker

## Local Development

```sh
npm ci
npm run dev
```

## GitHub Pages

This repo includes `.github/workflows/deploy.yml`.

1. Create a public GitHub repository named `stage-json-editor`.
2. Push this project to the repository's `main` branch.
3. In GitHub, open `Settings > Pages`.
4. Set `Source` to `GitHub Actions`.
5. The workflow will publish the app to GitHub Pages.

If the repository name is changed, update `base` in `vite.config.ts` to match the new repository path.
