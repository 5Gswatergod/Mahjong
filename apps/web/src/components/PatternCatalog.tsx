import { BookOpen, X } from "lucide-react";

type PatternCatalogEntry = {
  name: string;
  tai: string;
  example: string;
};

const patternCatalog: PatternCatalogEntry[] = [
  { name: "莊家", tai: "1", example: "莊家胡牌或放槍" },
  { name: "連莊", tai: "每連莊 +2", example: "連一拉一共 3 台，連二拉二共 5 台" },
  { name: "三元牌", tai: "1", example: "中中中、發發發、白白白任一刻子" },
  { name: "三暗刻", tai: "2", example: "三副未碰出的暗刻" },
  { name: "四暗刻", tai: "5", example: "四副未碰出的暗刻" },
  { name: "五暗刻", tai: "8", example: "五副未碰出的暗刻" },
  { name: "全求", tai: "2", example: "五副全由吃、碰、明槓完成，胡單吊" },
  { name: "春夏秋冬", tai: "2", example: "集滿春、夏、秋、冬" },
  { name: "梅蘭竹菊", tai: "2", example: "集滿梅、蘭、竹、菊" },
  { name: "混一色", tai: "4", example: "萬子一色加字牌" },
  { name: "清一色", tai: "8", example: "全部萬子；或全部字牌" },
  { name: "大三元", tai: "8", example: "中、發、白三組刻子" },
  { name: "小三元", tai: "4", example: "中、發、白其中兩刻子一對子" },
  { name: "大四喜", tai: "16", example: "東、南、西、北四組刻子" },
  { name: "小四喜", tai: "8", example: "三組風刻加一組風對子" },
  { name: "八仙過海", tai: "8", example: "拿齊八張花牌" },
  { name: "平胡", tai: "2", example: "五個順子、非字牌將、無花無字、非自摸非獨聽" },
  { name: "地胡", tai: "16", example: "子家第一次自摸即胡" },
  { name: "天胡", tai: "24", example: "莊家起手即胡" },
  { name: "獨聽", tai: "1", example: "只聽一張牌" },
  { name: "地聽", tai: "4", example: "起牌後八張內、無吃碰明槓時宣告聽牌" },
  { name: "天聽", tai: "8", example: "莊家第一張打出後已聽牌" },
  { name: "自摸", tai: "1", example: "自己摸進胡牌" },
  { name: "門清", tai: "1", example: "沒有吃、碰、明槓" },
  { name: "門清自摸", tai: "3", example: "門清且自摸，不重複算門清與自摸" },
  { name: "見花見台", tai: "每張 1", example: "任一花牌都算 1 台" },
  { name: "見風見台", tai: "每組 1", example: "東東東、南南南、西西西、北北北" },
  { name: "無字無花", tai: "2", example: "胡牌時完全沒有字牌與花牌" },
  { name: "槓牌", tai: "每組 1", example: "明槓或加槓" },
  { name: "暗槓", tai: "每組 2", example: "自己手中四張暗槓" },
  { name: "海底撈月", tai: "1", example: "海底最後一張自摸" },
  { name: "槓上開花", tai: "1", example: "槓或補花後補牌自摸" },
  { name: "聽牌", tai: "1", example: "宣告聽牌後胡牌" },
  { name: "搶槓胡", tai: "1", example: "胡對手加槓的那張牌" },
  { name: "碰碰胡", tai: "4", example: "全部刻子，沒有順子" }
];

export function PatternCatalog({ onClose }: { onClose: () => void }) {
  return (
    <div className="catalogBackdrop" role="dialog" aria-modal="true" aria-label="牌型目錄">
      <section className="catalogPanel">
        <header className="catalogHeader">
          <div>
            <span className="catalogKicker">
              <BookOpen size={16} />
              台灣 16 張
            </span>
            <h2>牌型目錄</h2>
          </div>
          <button className="closeSettlement" onClick={onClose} title="關閉牌型目錄">
            <X size={18} />
          </button>
        </header>

        <div className="catalogTable" role="table" aria-label="台數清單">
          <div className="catalogRow catalogHead" role="row">
            <span role="columnheader">台數名稱</span>
            <span role="columnheader">台數數量</span>
            <span role="columnheader">牌型示例</span>
          </div>
          {patternCatalog.map((pattern) => (
            <div className="catalogRow" role="row" key={pattern.name}>
              <strong role="cell">{pattern.name}</strong>
              <span className="catalogTai" role="cell">
                {pattern.tai}
              </span>
              <span role="cell">{pattern.example}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
