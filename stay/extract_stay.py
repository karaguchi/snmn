import os
import re
import pandas as pd
from datetime import datetime
import subprocess

# ディレクトリ設定
input_folder = './source'
output_folder = './output'

def format_date_for_excel(text, include_time=False):
    """文字列から数字を抜き出し、Excel/Notionが日付として認識できる型に変換"""
    if not text: return None
    clean_text = re.sub(r'<[^>]+>', '', text)
    nums_only = "".join([c if c.isdigit() else " " for c in clean_text])
    parts = nums_only.split()
    if len(parts) >= 3:
        try:
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
            if include_time and len(parts) >= 5:
                hour, minute = int(parts[3]), int(parts[4])
                return datetime(year, month, day, hour, minute)
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

    def clean_str(text):
        """HTMLタグを除去し、改行や余計な空白を完全に消し去る洗浄関数"""
        if not text: return ""
        text = re.sub(r'<[^>]+>', '', text) # タグ除去
        text = text.replace('\n', '').replace('\r', '').replace('\t', '') # 改行・タブ除去
        return text.strip()

    # 宿泊施設名
    hotel_name = clean_str(get_val(r'宿泊施設名<\/TD><TD>.*?<STRONG>(.*?)<\/STRONG>', html))

    # 予約受付番号 (閉じタグ忘れ対策)
    reserve_raw = get_val(r'予約受付番号<\/TD><TD>.*?<STRONG>(.*)', html)
    reserve_match = re.search(r'(RY[A-Za-z0-9]+)', reserve_raw)
    reserve_no = reserve_match.group(1) if reserve_match else "番号不明"

    # 部屋タイプ (部屋概要)
    room_type = clean_str(get_val(r'部屋のタイプ<\/TD><TD>(.*?)<\/TD>', html))

    # イン/アウト日付
    in_date = format_date_for_excel(get_val(r'チェックイン日<\/TD><TD>(.*?)<\/TD>', html))
    out_date = format_date_for_excel(get_val(r'チェックアウト日<\/TD><TD>(.*?)<\/TD>', html))

    # イン時間
    in_time = clean_str(get_val(r'チェックイン予定時刻<\/TD><TD>(.*?)<\/TD>', html))

    # 利用人数
    guest_text = get_val(r'利用人数<\/TD><TD>(.*?)<\/SMALL>', html)
    nums = re.findall(r'大人(\d+)', guest_text)
    guest_count = int(nums[0]) if nums else None

    # キャンセル期限
    cancel_raw = get_val(r'prefix:\s*"(.*?)"', html).replace('まで、', '').strip()
    cancel_limit = format_date_for_excel(cancel_raw, include_time=True)

    # 料金
    total_val = get_val(r'合計料金<\/TD><TD>.*?<STRONG>(.*?)<\/STRONG>', html)
    total_price = int(re.sub(r'[^0-9]', '', total_val)) if total_val else 0
    daily_prices = [int(p) for p in re.findall(r'＝(\d+)\s*円', html)]

    return {
        "ホテル名": hotel_name, "予約番号": reserve_no, "部屋タイプ": room_type,
        "イン日付": in_date, "イン時間": in_time,
        "アウト日付": out_date, "アウト時間": "",
        "利用人数": guest_count, "キャンセル期限日時": cancel_limit,
        "合計料金": total_price, "daily": daily_prices
    }

# --- メイン処理 ---
if not os.path.exists(input_folder): os.makedirs(input_folder)
if not os.path.exists(output_folder): os.makedirs(output_folder)

for filename in os.listdir(input_folder):
    if filename.endswith(('.html', '.htm')):
        data = extract_from_html(os.path.join(input_folder, filename))
        
        date_str = data["イン日付"].strftime('%Y%m%d') if data["イン日付"] else "00000000"
        clean_hotel = re.sub(r'[\\/:*?"<>|]', '', data["ホテル名"])
        output_file = os.path.join(output_folder, f"{date_str}_{clean_hotel}_{data['予約番号']}.xlsx")

        # DataFrame作成
        df = pd.DataFrame([{
            "ホテル名": data["ホテル名"], 
            "予約番号": data["予約番号"], 
            "部屋タイプ": data["部屋タイプ"],
            "キャンセル期限日時": data["キャンセル期限日時"], 
            "利用人数": data["利用人数"],
            "イン日付": data["イン日付"], 
            "イン時間": data["イン時間"],
            "アウト日付": data["アウト日付"], 
            "アウト時間": data["アウト時間"],
            "合計料金": data["合計料金"]
        }])
        
        for i, price in enumerate(data['daily']):
            df[f"{i+1}泊目"] = price

        # Excel出力
        with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
            df.to_excel(writer, index=False)
            ws = writer.sheets['Sheet1']
            ws.sheet_view.zoomScale = 90
            from openpyxl.styles import Alignment
            for i, col in enumerate(df.columns):
                ws.column_dimensions[chr(65+i)].width = 20
                for cell in ws[chr(65+i)][1:]:
                    if "日付" in col or "期限" in col:
                        cell.number_format = 'yyyy-mm-dd hh:mm' if "期限" in col else 'yyyy-mm-dd'
                        cell.alignment = Alignment(horizontal='left')
                    elif "料金" in col or "泊目" in col:
                        cell.number_format = '#,##0'
                        cell.alignment = Alignment(horizontal='right')

        print(f"'{output_file}' 作成完了❗️ ")

        # --- Notion貼付用テキストの生成 ---
        copy_df = df.copy()
        for col in copy_df.columns:
            if "日付" in col or "期限" in col:
                # 日付列の書式設定
                if pd.notnull(copy_df.loc[0, col]):
                    copy_df[col] = copy_df[col].dt.strftime('%Y-%m-%d %H:%M').str.replace(' 00:00', '')
            
        # 文字列の中の改行を念押しで削除し、タブ区切りに
        final_values = [str(val).replace('\n', '').replace('\r', '').strip() for val in copy_df.iloc[0]]
        copy_text = '\t'.join(final_values)

        # Macのクリップボードへ自動コピー
        process = subprocess.Popen('pbcopy', env={'LANG': 'en_US.UTF-8'}, stdin=subprocess.PIPE)
        process.communicate(copy_text.encode('utf-8'))
        
        print("-" * 30)
        print(f"✅ 【{data['ホテル名']}】のデータをコピーしたよ！")
        print("そのままNotionに貼り付けてね。")
        print("-" * 30)