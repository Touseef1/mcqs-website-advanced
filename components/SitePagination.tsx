"use client";

import ReactPaginate from "react-paginate";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

type Props = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  disabled?: boolean;
  itemLabel?: string;
  ariaLabel?: string;
  className?: string;
};

export function SitePagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  disabled = false,
  itemLabel = "items",
  ariaLabel = "Pages",
  className = "",
}: Props) {
  const safePageCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(1, page), safePageCount);
  const first = total ? (safePage - 1) * pageSize + 1 : 0;
  const last = Math.min(safePage * pageSize, total);

  return <div className={`site-pagination-wrap ${className}`.trim()}>
    <span className="site-pagination-summary">
      {itemLabel === "items" ? "Showing " : `${itemLabel} `}{first}–{last} of {total.toLocaleString()}
    </span>
    <div className="site-pagination-right">
      {onPageSizeChange && <label className="site-pagination-size-label">
        <span>Rows per page</span>
        <select aria-label="Rows per page" value={pageSize} disabled={disabled} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>}
      <nav aria-label={ariaLabel}>
        <ReactPaginate
          breakLabel="…"
          nextLabel={<><ChevronRight size={17} aria-hidden="true" /><span className="sr-only">Next page</span></>}
          previousLabel={<><ChevronLeft size={17} aria-hidden="true" /><span className="sr-only">Previous page</span></>}
          onPageChange={({ selected }) => onPageChange(selected + 1)}
          pageRangeDisplayed={3}
          marginPagesDisplayed={1}
          pageCount={safePageCount}
          forcePage={safePage - 1}
          renderOnZeroPageCount={null}
          containerClassName="site-pagination"
          pageClassName="site-pagination-item"
          pageLinkClassName="site-pagination-link"
          activeClassName="is-active"
          previousClassName="site-pagination-previous"
          nextClassName="site-pagination-next"
          disabledClassName="is-disabled"
          breakClassName="site-pagination-break"
          breakLinkClassName="site-pagination-link"
          disabledLinkClassName="is-disabled"
          previousAriaLabel="Previous page"
          nextAriaLabel="Next page"
        />
      </nav>
      <span className="site-pagination-page-status">Page {safePage} of {safePageCount}</span>
    </div>
  </div>;
}
