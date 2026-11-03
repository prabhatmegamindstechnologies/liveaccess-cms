// Editor layout on wide screens (xl, two columns): the editor fills the window below the top bar (61px + the main
// area's padding); the fields column scrolls on its own and the live preview stays in place on the right.
export const SPLIT_PAGE = "xl:flex xl:h-[calc(100vh-61px-3rem)] xl:flex-col";
export const SPLIT_GRID = "xl:min-h-0 xl:flex-1 xl:grid-rows-[minmax(0,1fr)] xl:items-stretch";
export const SPLIT_FIELDS = "xl:h-full xl:overflow-y-auto xl:pr-3 xl:pb-6";
