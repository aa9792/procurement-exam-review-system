# 採購證照複習系統

這是一個本機與 GitHub Pages 都可使用的採購證照複習系統。

## 功能

- 依考試科目分成法規課程、實務課程、其他課程
- 依《全部題庫.pdf》（資料產生日期 115/10/02）匯入 14 科，共 3599 題
- 每回自動產生 20 題練習
- 支援今日複習、未練題、錯題與隨機練習
- 依第一次成績提高「其他課程」出題比例
- 題幹自動標示反向問法、數字與法律強度，並提示主詞、問法、記憶鉤子
- 答錯需標註錯因；隔日答對 2 次才視為穩定
- 詳解只保留正確規則與法規依據，反向題不會把錯誤選項當口訣
- 使用 Firebase 登入同步，未登入時以瀏覽器 localStorage 保存進度

## 使用方式

直接開啟 `index.html`，或透過 GitHub Pages 瀏覽。

登入 Google 後，作答紀錄會同步至 Firebase；未登入時則保存在各瀏覽器本機，也可使用「匯出紀錄」與「匯入紀錄」搬移進度。

## 題庫資料

題庫資料由本機 PDF 解析後產生於 `data/questions.js`，比對報告在 `data/question-bank-update.json`。原始 PDF 與講義檔案未放入此 repo。

重新匯入最新合併題庫：

```powershell
python scripts/import_combined_question_bank.py "C:\path\to\全部題庫.pdf"
```

## Firebase 同步

網站使用 Firebase Authentication 與 Realtime Database 同步作答進度。

Realtime Database 規則：

```json
{
  "rules": {
    "procurementExamUsers": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

Authentication 需啟用 Google 登入，並將 GitHub Pages 網域加入 Authorized domains：

```text
aa9792.github.io
```
