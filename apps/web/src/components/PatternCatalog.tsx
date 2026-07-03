import type { GameMode } from "@taiwan-mahjong/shared";
import { BookOpen, X } from "lucide-react";

type PatternCatalogEntry = {
  name: string;
  value: string;
  example: string;
};

type PatternCatalogGroup = {
  title: string;
  entries: PatternCatalogEntry[];
};

type PatternCatalogContent = {
  kicker: string;
  title: string;
  tableLabel: string;
  nameHeader: string;
  valueHeader: string;
  detailHeader: string;
  groups: PatternCatalogGroup[];
};

const taiwanPatternCatalog: PatternCatalogGroup[] = [
  {
    title: "台灣 16 張",
    entries: [
      { name: "莊家", value: "1 台", example: "莊家胡牌或放槍" },
      { name: "連莊", value: "每連莊 +2 台", example: "連一拉一共 3 台，連二拉二共 5 台" },
      { name: "三元牌", value: "1 台", example: "中中中、發發發、白白白任一刻子" },
      { name: "三暗刻", value: "2 台", example: "三副未碰出的暗刻" },
      { name: "四暗刻", value: "5 台", example: "四副未碰出的暗刻" },
      { name: "五暗刻", value: "8 台", example: "五副未碰出的暗刻" },
      { name: "全求", value: "2 台", example: "五副全由吃、碰、明槓完成，胡單吊" },
      { name: "春夏秋冬", value: "2 台", example: "集滿春、夏、秋、冬" },
      { name: "梅蘭竹菊", value: "2 台", example: "集滿梅、蘭、竹、菊" },
      { name: "混一色", value: "4 台", example: "萬子一色加字牌" },
      { name: "清一色", value: "8 台", example: "全部萬子；或全部字牌" },
      { name: "大三元", value: "8 台", example: "中、發、白三組刻子" },
      { name: "小三元", value: "4 台", example: "中、發、白其中兩刻子一對子" },
      { name: "大四喜", value: "16 台", example: "東、南、西、北四組刻子" },
      { name: "小四喜", value: "8 台", example: "三組風刻加一組風對子" },
      { name: "八仙過海", value: "8 台", example: "拿齊八張花牌" },
      { name: "平胡", value: "2 台", example: "五個順子、非字牌將、無花無字、非自摸非獨聽" },
      { name: "地胡", value: "16 台", example: "子家第一次自摸即胡" },
      { name: "天胡", value: "24 台", example: "莊家起手即胡" },
      { name: "獨聽", value: "1 台", example: "只聽一張牌" },
      { name: "地聽", value: "4 台", example: "起牌後八張內、無吃碰明槓時宣告聽牌" },
      { name: "天聽", value: "8 台", example: "莊家第一張打出後已聽牌" },
      { name: "自摸", value: "1 台", example: "自己摸進胡牌" },
      { name: "門清", value: "1 台", example: "沒有吃、碰、明槓" },
      { name: "門清自摸", value: "3 台", example: "門清且自摸，不重複算門清與自摸" },
      { name: "見花見台", value: "每張 1 台", example: "任一花牌都算 1 台" },
      { name: "見風見台", value: "每組 1 台", example: "東東東、南南南、西西西、北北北" },
      { name: "無字無花", value: "2 台", example: "胡牌時完全沒有字牌與花牌" },
      { name: "槓牌", value: "每組 1 台", example: "明槓或加槓" },
      { name: "暗槓", value: "每組 2 台", example: "自己手中四張暗槓" },
      { name: "海底撈月", value: "1 台", example: "海底最後一張自摸" },
      { name: "槓上開花", value: "1 台", example: "槓或補花後補牌自摸" },
      { name: "聽牌", value: "1 台", example: "宣告聽牌後胡牌" },
      { name: "搶槓胡", value: "1 台", example: "胡對手加槓的那張牌" },
      { name: "碰碰胡", value: "4 台", example: "全部刻子，沒有順子" }
    ]
  }
];

const riichiYakuCatalog: PatternCatalogGroup[] = [
  {
    title: "一翻",
    entries: [
      { name: "立直", value: "1 翻", example: "門前聽牌宣告立直，並供託 1000 點" },
      { name: "一發", value: "1 翻", example: "立直後一巡內和牌，且中途沒有鳴牌" },
      { name: "門前清自摸和", value: "1 翻", example: "門前清狀態自摸和牌" },
      { name: "斷么九", value: "1 翻", example: "整副牌沒有一、九數牌與字牌" },
      { name: "平和", value: "1 翻", example: "四順子、非役牌雀頭，最後為兩面聽" },
      { name: "一盃口", value: "1 翻", example: "門前有兩組同花色同數順子" },
      { name: "役牌", value: "1 翻", example: "三元牌、自風或場風刻子/槓子" },
      { name: "嶺上開花", value: "1 翻", example: "開槓後摸嶺上牌自摸和" },
      { name: "槍槓", value: "1 翻", example: "榮和對手加槓的那張牌" },
      { name: "海底撈月", value: "1 翻", example: "摸牌山最後一張自摸和" },
      { name: "河底撈魚", value: "1 翻", example: "榮和本局最後一張舍牌" }
    ]
  },
  {
    title: "二翻",
    entries: [
      { name: "三色同順", value: "門前 2 / 副露 1 翻", example: "萬、筒、索各有同數順子" },
      { name: "三色同刻", value: "2 翻", example: "萬、筒、索各有同數刻子或槓子" },
      { name: "一氣通貫", value: "門前 2 / 副露 1 翻", example: "同一花色有 123、456、789 三副順子" },
      { name: "對對和", value: "2 翻", example: "全部由刻子/槓子加雀頭組成" },
      { name: "三暗刻", value: "2 翻", example: "三組暗刻或暗槓" },
      { name: "三槓子", value: "2 翻", example: "三組槓子" },
      { name: "七對子", value: "2 翻", example: "門前七組不同對子" },
      { name: "混全帶么九", value: "門前 2 / 副露 1 翻", example: "每組面子與雀頭都含么九，且包含字牌" },
      { name: "混老頭", value: "2 翻", example: "只用一、九數牌與字牌，通常複合對對和或七對子" },
      { name: "小三元", value: "2 翻", example: "兩組三元牌刻子/槓子，加一組三元牌雀頭" },
      { name: "雙立直", value: "2 翻", example: "第一巡且無鳴牌前宣告立直" }
    ]
  },
  {
    title: "三翻",
    entries: [
      { name: "混一色", value: "門前 3 / 副露 2 翻", example: "一種花色的數牌加字牌" },
      { name: "純全帶么九", value: "門前 3 / 副露 2 翻", example: "每組都含一、九數牌，且沒有字牌" },
      { name: "二盃口", value: "3 翻", example: "門前有兩組一盃口，不另計七對子" }
    ]
  },
  {
    title: "六翻",
    entries: [{ name: "清一色", value: "門前 6 / 副露 5 翻", example: "全部由同一花色的數牌組成" }]
  },
  {
    title: "役滿",
    entries: [
      { name: "國士無雙", value: "役滿", example: "十三種么九牌各一張，另任一么九作對" },
      { name: "國士無雙十三面聽", value: "役滿 / 雙倍役滿", example: "十三面聽的國士無雙，雙倍依規則採用" },
      { name: "大三元", value: "役滿", example: "中、發、白三組刻子或槓子" },
      { name: "四暗刻", value: "役滿", example: "四組暗刻或暗槓；單騎雙倍依規則採用" },
      { name: "字一色", value: "役滿", example: "全部由風牌與三元牌組成" },
      { name: "綠一色", value: "役滿", example: "只用綠色索子與發；是否必須有發依規則" },
      { name: "小四喜", value: "役滿", example: "三組風牌刻子/槓子，加一組風牌雀頭" },
      { name: "大四喜", value: "役滿 / 雙倍役滿", example: "四組風牌刻子或槓子，雙倍依規則採用" },
      { name: "清老頭", value: "役滿", example: "只用一、九數牌" },
      { name: "九蓮寶燈", value: "役滿", example: "門前同花 1112345678999 加同花任一張" },
      { name: "純正九蓮寶燈", value: "役滿 / 雙倍役滿", example: "九面聽的九蓮寶燈，雙倍依規則採用" },
      { name: "四槓子", value: "役滿", example: "四組槓子加雀頭" },
      { name: "天和", value: "役滿", example: "莊家起手 14 張自摸和" },
      { name: "地和", value: "役滿", example: "子家第一巡自摸，且此前沒有鳴牌" },
      { name: "累計役滿", value: "13 翻以上", example: "非役滿役與加翻合計達 13 翻以上，採否依規則" }
    ]
  },
  {
    title: "特殊",
    entries: [
      { name: "流局滿貫", value: "滿貫", example: "流局時舍牌全為么九且未被鳴牌，採否依規則" },
      { name: "懸賞牌/寶牌", value: "不算役", example: "和牌後才加翻，不能單獨作為起胡役" }
    ]
  }
];

const catalogs: Record<GameMode, PatternCatalogContent> = {
  taiwan: {
    kicker: "台灣 16 張",
    title: "牌型目錄",
    tableLabel: "台數清單",
    nameHeader: "台數名稱",
    valueHeader: "台數",
    detailHeader: "牌型示例",
    groups: taiwanPatternCatalog
  },
  riichi: {
    kicker: "日式立直",
    title: "役數目錄",
    tableLabel: "役數清單",
    nameHeader: "役種",
    valueHeader: "翻數",
    detailHeader: "成立條件",
    groups: riichiYakuCatalog
  }
};

export function PatternCatalog({ mode, onClose }: { mode: GameMode; onClose: () => void }) {
  const catalog = catalogs[mode];

  return (
    <div className="catalogBackdrop" role="dialog" aria-modal="true" aria-label={catalog.title}>
      <section className="catalogPanel">
        <header className="catalogHeader">
          <div>
            <span className="catalogKicker">
              <BookOpen size={16} />
              {catalog.kicker}
            </span>
            <h2>{catalog.title}</h2>
          </div>
          <button className="closeSettlement" onClick={onClose} title={`關閉${catalog.title}`}>
            <X size={18} />
          </button>
        </header>

        <div className="catalogTable" role="table" aria-label={catalog.tableLabel}>
          <div className="catalogRow catalogHead" role="row">
            <span role="columnheader">{catalog.nameHeader}</span>
            <span role="columnheader">{catalog.valueHeader}</span>
            <span role="columnheader">{catalog.detailHeader}</span>
          </div>
          {catalog.groups.map((group) => (
            <div className="catalogGroup" key={group.title} role="rowgroup">
              <div className="catalogSectionTitle" role="row">
                <span role="cell">{group.title}</span>
              </div>
              {group.entries.map((pattern) => (
                <div className="catalogRow" role="row" key={`${group.title}-${pattern.name}`}>
                  <strong role="cell">{pattern.name}</strong>
                  <span className="catalogTai" role="cell">
                    {pattern.value}
                  </span>
                  <span role="cell">{pattern.example}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
