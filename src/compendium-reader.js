(function initCompendiumReader(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ProcurementCompendiumReader = api;
})(typeof window !== "undefined" ? window : globalThis, function createCompendiumReader() {
  const BOOK_SECTIONS = [
    { page: 11, title: "壹、政府採購法及其施行細則之條文對照" },
    { page: 63, title: "貳、政府採購法相關子法及相關規定" },
    { page: 575, title: "參、修正版 WTO 政府採購協定" },
    { page: 621, title: "肆、其他相關法令" },
  ];

  const BOOK_CHAPTERS = [
    [11, "政府採購法及其施行細則之條文對照"],
    [63, "政府採購法相關子法及相關規定"],
    [69, "工程價格資料庫作業辦法"],
    [71, "機關採購工作及審查小組設置及作業辦法"],
    [73, "查核金額"],
    [75, "中央機關未達公告金額採購監辦辦法"],
    [77, "公告金額"],
    [83, "水管、電氣與建築工程合併或分開招標原則"],
    [85, "外國廠商參與非條約協定採購處理辦法"],
    [91, "選擇性招標錯誤行為態樣"],
    [95, "政府採購法第二十二條第一項各款執行錯誤態樣"],
    [109, "機關委託技術服務廠商評選及計費辦法"],
    [157, "機關委託研究發展作業辦法"],
    [159, "機關邀請或委託文化藝術專業人士機構團體提供藝文服務作業辦法"],
    [169, "中央機關未達公告金額採購招標辦法"],
    [173, "統包實施辦法"],
    [175, "統包作業須知"],
    [177, "共同投標辦法"],
    [181, "政府採購法第二十六條執行注意事項"],
    [185, "政府採購公告及公報發行辦法"],
    [197, "招標期限標準"],
    [201, "押標金保證金暨其他擔保作業辦法"],
    [255, "公共工程招標文件公開閱覽制度實施要點"],
    [259, "替代方案實施辦法"],
    [263, "投標廠商資格與特殊或巨額採購認定標準"],
    [270, "認定專案管理勞務採購為特殊採購"],
    [271, "機關洽請代辦工程採購執行要點"],
    [275, "國內廠商標價優惠實施辦法"],
    [281, "中央機關小額採購"],
    [283, "發現足以影響採購公正之違法或不當行為者"],
    [285, "不同投標廠商間投標文件重大異常關聯之處理"],
    [287, "評分及格最低標錯誤行為態樣"],
    [289, "最有利標評選辦法"],
    [297, "最有利標錯誤行為態樣"],
    [315, "採購契約要項"],
    [337, "工程施工查核小組組織準則"],
    [341, "工程施工查核小組作業辦法"],
    [347, "公共工程施工品質管理作業要點"],
    [369, "採購申訴審議收費辦法"],
    [371, "採購申訴審議規則"],
    [377, "採購履約爭議調解規則"],
    [383, "採購履約爭議調解收費辦法"],
    [387, "採購申訴審議委員會組織準則"],
    [395, "共同供應契約實施辦法"],
    [399, "中央機關共同供應契約集中採購實施要點"],
    [403, "電子採購作業辦法"],
    [409, "採購評選委員會組織準則"],
    [413, "採購評選委員會審議規則"],
    [419, "採購評選委員會委員須知"],
    [423, "各機關採購評選委員會專家學者參考名單"],
    [431, "採購專業人員資格考試訓練發證及管理辦法"],
    [439, "採購專業人員訓練計畫"],
    [453, "機關優先採購環境保護產品辦法"],
    [459, "扶助中小企業參與政府採購辦法"],
    [461, "政府採購法第九十八條得標廠商繳納代金之方式"],
    [463, "甄選投資廠商延長履約期限程序不適用政府採購法"],
    [465, "機關堪用財物無償讓與辦法"],
    [467, "政府採購法第 101 條執行注意事項"],
    [475, "特殊軍事採購適用範圍及處理辦法"],
    [479, "特別採購招標決標處理辦法"],
    [483, "採購文件保存之場所"],
    [485, "採購稽核小組組織準則"],
    [543, "政府採購法規定須報上級機關核准核定同意備查事項"],
    [547, "採購契約變更或加減價核准監辦備查規定一覽表"],
    [549, "變更設計之新增工程項目單價編列方式"],
    [551, "政府電子採購網資訊取得及使用要點"],
    [557, "政府採購錯誤行為態樣"],
    [569, "招標投標及契約文件範本"],
    [571, "行政院公共工程委員會政府採購諮詢小組"],
    [575, "修正版 WTO 政府採購協定"],
    [621, "其他相關法令"],
    [623, "技師法"],
    [637, "技師法施行細則"],
    [641, "工程技術顧問公司管理條例"],
    [655, "政府公共工程計畫與經費審議作業要點"],
    [661, "公共工程生態檢核注意事項"],
    [681, "行政院公共工程委員會提供政府資訊收費標準"],
  ].map(([page, title]) => ({ page, title }));

  const MONEY_PATTERN = /(?:新臺幣\s*)?[零〇一二三四五六七八九十百千萬億兆\d,.]+\s*(?:億|萬|千)?\s*元(?:以上|以下|未滿|以內)?|(?:公告|查核|巨額|小額|預算|採購|契約|決標|底價)金額/g;
  const RATIO_PATTERN = /百分之\s*[零〇一二三四五六七八九十百千\d.]+|\d+(?:\.\d+)?\s*%|(?:半數|三分之[一二三]|四分之[一二三])(?:以上|以下)?/g;
  const DATE_PATTERN = /中華民國\s*\d+\s*年\s*\d+\s*月\s*\d+\s*日|民國\s*\d+\s*年(?:\s*\d+\s*月(?:\s*\d+\s*日)?)?|[零〇一二三四五六七八九十百千\d]+\s*(?:工作日|日|天|個月|月|年)(?:以上|以下|以內|前|後|內)?/g;

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[\s，。；：、（）()「」『』【】！？,.!?：;\-_/]/g, "");
  }

  function numberToChinese(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 9999) return String(value);
    if (number === 0) return "零";
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    const units = ["", "十", "百", "千"];
    const chars = String(number).split("").map(Number);
    let output = "";
    let pendingZero = false;
    chars.forEach((digit, index) => {
      const unitIndex = chars.length - index - 1;
      if (!digit) {
        pendingZero = output.length > 0 && chars.slice(index + 1).some(Boolean);
        return;
      }
      if (pendingZero) output += "零";
      if (!(digit === 1 && unitIndex === 1 && output === "")) output += digits[digit];
      output += units[unitIndex];
      pendingZero = false;
    });
    return output;
  }

  function queryAliases(query) {
    const source = String(query || "");
    const chineseNumberQuery = source.replace(/\d+/g, (value) => numberToChinese(value));
    return [...new Set([normalize(source), normalize(chineseNumberQuery)].filter(Boolean))];
  }

  function extractPrintedPages(text) {
    const matches = [...String(text || "").matchAll(/總\s*(\d+)/g)].map((match) => Number(match[1]));
    return [...new Set(matches.filter(Number.isFinite))];
  }

  function formatPrintedPages(text) {
    const pages = extractPrintedPages(text);
    if (!pages.length) return "前置頁或附錄頁";
    if (pages.length === 1) return `總${pages[0]}`;
    return `總${pages[0]}–總${pages[pages.length - 1]}`;
  }

  function cleanPageText(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/^\s*總\s*\d+(?:\s+總\s*\d+)?\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function collectRanges(value) {
    const ranges = [];
    [
      ["money", MONEY_PATTERN],
      ["ratio", RATIO_PATTERN],
      ["date", DATE_PATTERN],
    ].forEach(([type, pattern]) => {
      pattern.lastIndex = 0;
      for (const match of String(value || "").matchAll(pattern)) {
        ranges.push({ start: match.index, end: match.index + match[0].length, type });
      }
    });
    return ranges
      .sort((left, right) => left.start - right.start || right.end - left.end)
      .filter((range, index, all) => !all.slice(0, index).some((kept) => range.start < kept.end));
  }

  function annotateText(value) {
    const text = String(value || "");
    const ranges = collectRanges(text);
    const segments = [];
    let cursor = 0;
    ranges.forEach((range) => {
      if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), type: "plain" });
      segments.push({ text: text.slice(range.start, range.end), type: range.type });
      cursor = range.end;
    });
    if (cursor < text.length) segments.push({ text: text.slice(cursor), type: "plain" });
    return segments;
  }

  function searchPages(pages, query, limit = 40) {
    const aliases = queryAliases(query);
    if (!aliases.length) return [];
    return (pages || [])
      .map((page) => {
        const title = normalize(page.title);
        const body = normalize(page.text);
        const keyword = aliases.find((alias) => title.includes(alias) || body.includes(alias));
        if (!keyword) return null;
        const position = body.indexOf(keyword);
        const raw = cleanPageText(page.text).replace(/\s+/g, " ");
        const rawKeyword = String(query || "").trim();
        const rawPosition = rawKeyword ? raw.indexOf(rawKeyword) : -1;
        const snippetStart = Math.max(0, (rawPosition >= 0 ? rawPosition : Math.min(position, raw.length)) - 42);
        return {
          page,
          score: title === keyword ? 0 : title.includes(keyword) ? 1 : 2,
          snippet: raw.slice(snippetStart, snippetStart + 150),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.score - right.score || left.page.page - right.page.page)
      .slice(0, limit);
  }

  function sectionForPage(pageNumber) {
    return [...BOOK_SECTIONS].reverse().find((section) => pageNumber >= section.page) || BOOK_SECTIONS[0];
  }

  return {
    BOOK_CHAPTERS,
    BOOK_SECTIONS,
    annotateText,
    cleanPageText,
    extractPrintedPages,
    formatPrintedPages,
    searchPages,
    sectionForPage,
  };
});
