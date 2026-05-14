import os
import re
import pandas as pd
from datetime import datetime

input_folder = './source'
output_file = 'deadline.xlsx'

def format_date_for_excel(text, include_time=False):
    """文字列から数字を抜き出し、Excel/Notionが日付として認識できる型に変換"""
    if not text: return None
    
    # HTMLタグ削除
    clean_text = re.sub(r'<[^>]+>', '', text)
    # 数字以外をスペースに置換
    nums_only = "".join([c if c.isdigit() else " " for c in clean_text])
    parts = nums_only.split()
    
    if len(parts) >= 3:
        try:
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
            # 時刻が含まれている場合 (例: 23:59)
            if include_time and len(parts) >= 5:
                hour, minute = int(parts[3]), int(parts[4])
                return datetime(year, month, day, hour, minute)
            # 日付のみ
            return datetime(year, month, day)
        except ValueError:
            return None
    return None

def extract_from_html(file_path):
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        html = f.read()
    
    def get_val(pattern, content):
        m = re.search(pattern, content, re.S)
        return m.group(1) if m else ""

    # 1. ホテル名
    hotel_name = re.sub(r'<[^>]+>', '', get_val(r'宿泊施設名<\/TD><TD>.*?<STRONG>(.*?)<\/STRONG>', html)).strip()

    # 2. イン/アウト日付 (日付型)
    in_date = format_date_for_excel(get_val(r'チェックイン日<\/TD><TD>(.*?)<\/TD>', html))
    out_date = format_date_for_excel(get_val(r'チェックアウト日<\/TD><TD>(.*?)<\/TD>', html))

    # 3. イン時間
    in_time = re.sub(r'<[^>]+>', '', get_val(r'チェックイン予定時刻<\/TD><TD>(.*?)<\/TD>', html)).strip()

    # 4. 利用人数 (数値型)
    guest_text = get_val(r'利用人数<\/TD><TD>(.*?)<\/SMALL>', html)
    nums = re.findall(r'大人(\d+)', guest_text)
    guest_count = int(nums[0]) if nums else None

    # 5. キャンセル期限 (日付型・時刻あり)
    cancel_raw = get_val(r'prefix:\s*"(.*?)"', html).replace('まで、', '').strip()
    cancel_limit = format_date_for_excel(cancel_raw, include_time=True)

    # 6. 料金 (数値型)
    total_val = get_val(r'合計料金<\/TD><TD>.*?<STRONG>(.*?)<\/STRONG>', html)
    total_price = int(re.sub(r'[^0-9]', '', total_val)) if total_val else 0
    daily_prices = [int(p) for p in re.findall(r'＝(\d+)\s*円', html)]

    return {
        "ホテル名": hotel_name, "イン日付": in_date, "イン時間": in_time,
        "アウト日付": out_date, "アウト時間": "", "利用人数": guest_count,
        "キャンセル期限日時": cancel_limit, "合計料金": total_price,
        "daily": daily_prices
    }

# --- メイン処理 ---
results = []
if not os.path.exists(input_folder): os.makedirs(input_folder)

for filename in os.listdir(input_folder):
    if filename.endswith(('.html', '.htm')):
        results.append(extract_from_html(os.path.join(input_folder, filename)))

if results:
    rows = []
    max_stay = max(len(r['daily']) for r in results) if results else 0
    for r in results:
        row = {
            "ホテル名": r["ホテル名"], "イン日付": r["イン日付"], "イン時間": r["イン時間"],
            "アウト日付": r["アウト日付"], "アウト時間": r["アウト時間"], "利用人数": r["利用人数"],
            "キャンセル期限日時": r["キャンセル期限日時"], "合計料金": r["合計料金"]
        }
        for i in range(max_stay):
            row[f"{i+1}泊目"] = r['daily'][i] if i < len(r['daily']) else None
        rows.append(row)

    df = pd.DataFrame(rows)

    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        df.to_excel(writer, index=False)
        ws = writer.sheets['Sheet1']
        ws.sheet_view.zoomScale = 90
        
        from openpyxl.styles import Alignment
        for i, col in enumerate(df.columns):
            ws.column_dimensions[chr(65+i)].width = 20
            for cell in ws[chr(65+i)][1:]:
                # 日付・期限列の設定
                if "日付" in col or "期限" in col:
                    cell.number_format = 'yyyy-mm-dd hh:mm' if "期限" in col else 'yyyy-mm-dd'
                    cell.alignment = Alignment(horizontal='left')
                elif "料金" in col or "泊目" in col:
                    cell.number_format = '#,##0'
                    cell.alignment = Alignment(horizontal='right')

    print(f"\n✨ 完了！ '{output_file}' を確認してね。")
    if not df.empty:
        # Notion貼付用にタブ区切りテキストを表示（日付は文字列に変換）
        copy_df = df.copy()
        for col in copy_df.columns:
            if "日付" in col or "期限" in col:
                copy_df[col] = copy_df[col].dt.strftime('%Y-%m-%d %H:%M').replace(' 00:00', '')
        
        copy_text = copy_df.iloc[0].astype(str).str.cat(sep='\t')
        print("\n👇 【Notionコピペ用】この下の1行をコピーしてね")
        print("-" * 30)
        print(copy_text)
        print("-" * 30)