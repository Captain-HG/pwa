"""生成账单导入测试用的脱敏样本：python scripts/make_import_fixtures.py

数据全部为虚构，只模仿真实导出文件的结构（编码、说明行、表头、单元格类型、退款写法）。
真实样本放在 samples/，不进入代码库。
"""
from __future__ import annotations

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures"

# ---------------- 支付宝：GBK CSV ----------------

ALIPAY_PREAMBLE = [
    "-" * 70,
    "导出信息：",
    "姓名：张三",
    "支付宝账户：13800000000",
    "起始时间：[2026-09-27 00:00:00]    终止时间：[2026-10-27 23:59:59]",
    "导出交易类型：[全部]",
    "导出时间：[2026-10-27 16:59:11]",
    "共11笔记录",
    "收入：2笔 109.90元",
    "支出：8笔 106.94元",
    "不计收支：1笔 137.45元",
    "",
    "特别提示：",
    "1.本回单内容可表明支付宝受理了相应支付交易申请；",
    "2.本明细仅供个人对账使用。",
    "",
    "------------------------支付宝支付科技有限公司  电子客户回单------------------------",
]
ALIPAY_HEADER = "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,"

# 交易时间, 交易分类, 交易对方, 对方账号, 商品说明, 收/支, 金额, 收/付款方式, 交易状态, 交易订单号, 商家订单号, 备注
ALIPAY_ROWS = [
    ("2026-10-27 11:32:28", "餐饮美食", "美团外卖", "/", "午餐套餐", "支出", "25.25", "示例银行储蓄卡(0001)", "交易成功", "2026102710255301046700000001", "M0001"),
    ("2026-10-26 09:10:00", "日用百货", "某某旗舰店", "abc***@example.com", '"纸巾,10包装"', "支出", "11.66", "示例银行储蓄卡(0001)", "等待确认收货", "2026102610255301046700000002", "M0002"),
    ("2026-10-25 19:25:59", "医疗健康", "某某药房", "/", "体检券", "支出", "0.00", "", "支付成功", "2026102523001467381400000003", "M0003"),
    ("2026-10-24 08:00:00", "信用借还", "花呗", "/", "信用卡还款", "不计收支", "137.45", "示例银行储蓄卡(0001)", "还款成功", "2026102410255301046700000004", "M0004"),
    ("2026-10-23 12:00:00", "转账红包", "李四", "li***@example.com", "收款", "收入", "100.00", "", "交易成功", "2026102310255301046700000005", "/"),
    ("2026-10-22 12:00:00", "日用百货", "某某小店", "/", "已取消的订单", "支出", "30.00", "", "交易关闭", "2026102210255301046700000006", "M0006"),
    ("2026-10-21 15:00:00", "退款", "某某旗舰店", "/", "退款-数据线", "收入", "9.90", "", "退款成功", "2026102110255301046700000007", "M0007"),
    ("2026-10-20 18:30:00", "交通出行", "滴滴出行", "/", "快车", "支出", "18.80", "示例银行储蓄卡(0001)", "交易成功", "2026102010255301046700000008", "M0008"),
    ("2026-10-19 10:00:00", "保险", "某某保险公司", "/", "意外险保费", "支出", "4.10", "示例银行储蓄卡(0001)", "支付成功", "2026101910255301046700000009", "M0009"),
    ("2026-10-18 10:00:00", "宠物", "某某宠物店", "/", "猫粮", "支出", '"1,016.00"', "示例银行储蓄卡(0001)", "交易成功", "2026101810255301046700000010", "M0010"),
    ("2026-10-17 10:00:00", "数码电器", "某某数码", "/", "耳机", "支出", "0.00", "", "支付成功", "2026101710255301046700000011", "M0011"),
]


def alipay_csv() -> bytes:
    lines = list(ALIPAY_PREAMBLE) + [ALIPAY_HEADER]
    for r in ALIPAY_ROWS:
        *head, order, merchant = r
        # 真实文件中单号末尾带制表符；备注列为空，行尾多一个逗号
        lines.append(",".join(head) + f",{order}\t,{merchant}\t,,")
    return ("\r\n".join(lines) + "\r\n").encode("gbk")


# ---------------- 微信：XLSX（共享字符串 + 数字单元格） ----------------

WECHAT_PREAMBLE = [
    "微信支付账单明细",
    "微信昵称：[张三]",
    "起始时间：[2026-09-27 00:00:00] 终止时间：[2026-10-27 23:59:59]",
    "导出类型：[全部账单]",
    "导出时间：[2026-10-27 16:58:01]",
    "共13笔记录",
    "收入：6笔 380.68元",
    "支出：6笔 245.80元",
    "中性交易：1笔 100.00元",
    "注：",
    "1. 充值/提现/理财通购买/零钱通存取/信用卡还款等交易，将计入中性交易",
    "4. 本账单中所有时间均为UTC+08:00时间",
    "----------------------微信支付账单明细列表--------------------",
]
WECHAT_HEADER = ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注"]


def serial(day: int, hh: int, mm: int, ss: int = 0) -> float:
    """2026-10-<day> hh:mm:ss（UTC+8）的 Excel 序列数；2026-10-01 = 46296"""
    return 46296 + (day - 1) + (hh * 3600 + mm * 60 + ss) / 86400


# 交易时间(序列数), 交易类型, 交易对方, 商品, 收/支, 金额(数字或字符串), 支付方式, 当前状态, 交易单号, 商户单号, 备注
WECHAT_ROWS = [
    (serial(27, 9, 17, 42), "商户消费", "美团", "美团订单", "支出", 23, "零钱", "支付成功", "4200000001202610270000000001", "M1001", "/"),
    (serial(26, 18, 0), "商户消费", "新电途", "充电预付款", "支出", 50, "示例银行储蓄卡(0001)", "已退款(¥30.01)", "4200000001202610260000000002", "M1002", "/"),
    (serial(26, 19, 30), "新电途-退款", "新电途", "充电预付款", "收入", 30.01, "示例银行储蓄卡(0001)", "已退款¥30.01", "4200000001202610260000000003", "/", "/"),
    (serial(25, 8, 0), "商户消费", "特来电", "充电预付款", "支出", 50, "示例银行储蓄卡(0001)", "已全额退款", "4200000001202610250000000004", "M1004", "/"),
    (serial(25, 8, 40), "特来电-退款", "特来电", "充电预付款", "收入", 50, "示例银行储蓄卡(0001)", "已全额退款", "4200000001202610250000000005", "/", "/"),
    (serial(24, 12, 0), "微信红包-退款", "/", "/", "收入", 200, "示例银行储蓄卡(0001)", "已全额退款", "4200000001202610240000000006", "/", "/"),
    (serial(23, 20, 0), "转账", "王五", "转账", "支出", 100, "示例银行储蓄卡(0001)", "对方已收钱", "1000050001202610230000000007", "/", "/"),
    (serial(22, 21, 0), "转账", "李四", "转账", "收入", 88, "/", "已存入零钱", "1000050001202610220000000008", "/", "/"),
    (serial(21, 21, 0), "微信红包", "李四", "/", "收入", 6.66, "/", "已存入零钱", "10000399012026102100000000009", "/", "/"),
    (serial(20, 7, 45), "扫二维码付款", "某某商行", "/", "支出", 10.5, "零钱", "已转账", "10001071012026102000000000010", "/", "/"),
    (serial(19, 10, 0), "零钱提现", "/", "/", "/", 100, "/", "提现已到账", "1001060001202610190000000011", "/", "/"),
    # 浮点表示的金额，应四舍五入为 12.34
    (serial(18, 15, 0), "商户消费", "瑞幸咖啡", "生椰拿铁", "支出", "12.340000000000002", "零钱", "支付成功", "4200000001202610180000000012", "M1012", "/"),
    (serial(17, 8, 0), "商户消费", "滴滴出行", "快车", "支出", 0, "零钱", "支付成功", "4200000001202610170000000013", "M1013", "/"),
]


def col(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def wechat_xlsx() -> bytes:
    strings: list[str] = []
    index: dict[str, int] = {}

    def sidx(v: str) -> int:
        if v not in index:
            index[v] = len(strings)
            strings.append(v)
        return index[v]

    rows_xml = []
    r = 0

    def add_row(values: list) -> None:
        nonlocal r
        r += 1
        cells = []
        for i, v in enumerate(values):
            ref = f"{col(i)}{r}"
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                cells.append(f'<c r="{ref}"><v>{repr(v)}</v></c>')
            elif isinstance(v, str) and v.replace(".", "", 1).isdigit() and r > len(WECHAT_PREAMBLE) + 1 and i == 5:
                cells.append(f'<c r="{ref}"><v>{v}</v></c>')  # 浮点表示的数字金额
            else:
                cells.append(f'<c r="{ref}" t="s"><v>{sidx(str(v))}</v></c>')
        rows_xml.append(f'<row r="{r}">{"".join(cells)}</row>')

    for line in WECHAT_PREAMBLE:
        add_row([line])
    add_row(WECHAT_HEADER)
    for row in WECHAT_ROWS:
        add_row(list(row))

    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    sheet = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet {ns}><sheetData>{"".join(rows_xml)}</sheetData></worksheet>'
    sst = "".join(f"<si><t>{escape(s)}</t></si>" for s in strings)
    shared = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst {ns} count="{len(strings)}" uniqueCount="{len(strings)}">{sst}</sst>'
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        "</Types>",
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<?xml version="1.0" encoding="UTF-8"?><workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": sheet,
        "xl/sharedStrings.xml": shared,
    }
    path = OUT / "wechat.xlsx"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return path.read_bytes()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "alipay.csv").write_bytes(alipay_csv())
    wechat_xlsx()
    print("fixtures written to", OUT)
