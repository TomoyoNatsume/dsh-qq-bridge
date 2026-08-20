# Third-party notices

This project is released under the MIT License. It interoperates with, or
depends on, the following third-party projects.

This notice is for attribution and release hygiene. It does not replace the
license text or usage terms of the upstream projects.

## Runtime dependencies

| Project | Role | License |
| --- | --- | --- |
| @tencent-connect/qqbot-nodejs | Tencent QQ Open Platform bot SDK used by the optional official bot provider | MIT |
| ws | WebSocket client used to connect to OneBot/NapCat | MIT |
| zod | Runtime configuration validation | MIT |

## Development dependencies

| Project | Role | License |
| --- | --- | --- |
| TypeScript | Type checking and build | Apache-2.0 |
| Vitest | Test runner | MIT |
| @types/node | Type definitions | MIT |
| @types/ws | Type definitions | MIT |

## External projects and protocols

| Project | Role | Bundled in this repository? | License / terms |
| --- | --- | --- | --- |
| NapCatQQ | Optional QQ/OneBot runtime used by users to provide a OneBot WebSocket endpoint | No | Limited Redistribution License for NapCat |
| Tencent QQ Open Platform | Optional official QQ bot runtime and API service | No | Tencent platform terms |
| OneBot | Chat bot protocol used for the bridge interface | No | MIT |
| DeepSeek Harness (`dsh`) | Host application and agent runtime that loads this plugin | No | MIT |

## Release notes

- This repository does not include, modify, or redistribute NapCatQQ binaries
  or source code. Users install and run NapCatQQ separately.
- If a release package ever includes NapCatQQ files, its full upstream license
  text and source/copyright information must be included, and the release must
  comply with NapCatQQ's non-commercial and redistribution restrictions.
- Do not commit QQ credentials, Tencent AppSecret, NapCat WebUI tokens, OneBot
  access tokens, or DSH API keys into this repository or release archives.
