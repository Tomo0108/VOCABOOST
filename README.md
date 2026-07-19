# Vocaboost

TOEIC 頻出単語をオフラインで反復できる、ブラウザ向けの学習アプリ（PWA）です。進捗・設定は端末内（IndexedDB）に保存されます。

## できること

- **ホーム**: 復習待ち・学習済み・リストの単語数の概要、セッション途中からの再開
- **学習**: 10単語ずつの「新規」「ミックス」セッション、4択クイズとフィードバック
- **復習**: 間隔反復（SRS）に基づくスケジュール表示と復習セッション
- **設定**: ライト / ダーク / システムテーマ、復習間隔のコンパクト化、例文表示、英語の自動読み上げ、JSON バックアップのエクスポート・インポート

## 技術スタック

- [Next.js](https://nextjs.org/) 16（App Router）・[React](https://react.dev/) 19
- [TypeScript](https://www.typescriptlang.org/)、[Tailwind CSS](https://tailwindcss.com/) 4
- UI: [Base UI](https://base-ui.com/)、[shadcn/ui](https://ui.shadcn.com/) 系コンポーネント、[Lucide](https://lucide.dev/) アイコン
- 永続化: [idb-keyval](https://github.com/jakearchibald/idb-keyval)
- PWA: [next-pwa](https://github.com/shadowwalker/next-pwa)

## 開発

Node.js を用意したうえで、依存関係を入れて開発サーバーを起動します。

```bash
npm install
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

### よく使うコマンド

| コマンド | 説明 |
|----------|------|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド |
| `npm run start` | 本番サーバー（ビルド後） |
| `npm run lint` | ESLint |
| `npm run icons:export` | `public/icon-pop-source.png` から PWA 用 PNG を再生成（`docs/pwa-icon-design.md` 参照） |

### データ生成スクリプト（メンテ用）

単語リストの再生成・補完には別途 API キーや入力ファイルが必要な場合があります。スクリプト本体は `scripts/` を参照してください。

| コマンド | 説明 |
|----------|------|
| `npm run data:tsl` | TSL 由来データのビルド |
| `npm run data:wiktionary:ja` | Wiktionary による日本語補完 |
| `npm run data:fill-ja` | 欠損和訳の補填（Google 等） |
| `npm run data:upgrade` | 和訳・例文・場面タグ・難易度・IPA の品質アップグレード |
| `npm run data:ipa:force` | IPA を CMU 辞書から再計算して上書き |
| `npm run audit:vocab` | 単語データの品質監査 |

## デプロイ

静的出力に依存しない通常の Next.js アプリとしてホスティングできます。PWA の Service Worker は本番ビルドで有効になります（開発時は無効）。

## ライセンス

リポジトリにライセンスファイルがない場合は、利用条件はリポジトリ所有者に確認してください。
