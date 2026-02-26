# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Majanduskava Launch Protocol v1

1. `npm run build`
2. `npm run preview`
3. Kontrolli lokaalselt:
   - Print view (Tab 6 → Prindi kokkuvõte)
   - policyVersion / reportDigest / stateSignature nähtavad
   - loopGuard status OK
   - JSON export → import round-trip (Tab 6 → Salvesta / Laadi)
4. `npm run deploy`
5. Ava GitHub Pages URL ja kontrolli:
   - Assetid laadivad (404 puudub)
   - Print view töötab productionis
6. Piloot:
   - 1 täismahus majanduskava sisestus algusest lõpuni
   - RunReport kontroll (Tab 6 → TracePanel)
   - JSON bundle arhiveeritud
