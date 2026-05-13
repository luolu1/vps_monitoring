# Outlook Auto Login (Chrome Extension)

This project now includes a Chrome extension that opens Outlook in incognito and auto-fills login fields.

## 1. Load extension in Chrome

1. Open `chrome://extensions/`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select folder: `E:\opencode\zhuche\extension`

## 2. Allow in incognito

1. In extension card, click **Details**
2. Enable **Allow in Incognito**

## 3. Use extension popup

1. Click extension icon
2. Fill `email`, `password`, optional `2FA`
3. Click `打开无痕并登录`

It will open `https://outlook.live.com/mail/` in incognito and attempt automatic login.

## 4. Notes

- This is for your own account testing only.
- If Microsoft presents unexpected verification UI, you may need manual interaction.

## 5. Optional Playwright script

The previous Playwright script files are still in `src/` if you want CLI automation later.
