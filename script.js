// ============================================
// THEME (must run first, before anything renders)
// ============================================
(function applyThemeImmediately() {
  // Read the new key first, then fall back to the legacy key
  let choice = localStorage.getItem("marketaThemeChoice");
  if (choice !== "light" && choice !== "dark" && choice !== "system") {
    const legacy = localStorage.getItem("marketaTheme");
    if (legacy === "light" || legacy === "dark") {
      choice = legacy;
    } else {
      choice = "system";
    }
  }

  let resolved;
  if (choice === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } else {
    resolved = choice;
  }

  document.documentElement.setAttribute("data-theme", resolved);
})();

// ============================================
// USER IDENTITY
// ============================================
function generateUserId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "user_";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

let currentUserId = localStorage.getItem("marketaUserId");
if (!currentUserId) {
  currentUserId = generateUserId();
  localStorage.setItem("marketaUserId", currentUserId);
}

// ============================================
// GLOBAL STATE
// ============================================
let currentPhotos = [];
let currentItemIndex = null;
let currentPhotoIndex = 0;
let editingListingIndex = null;
let currentSellStep = 1;
let _sellPublishMode = false; // true when we're editing an existing listing

let chatMode = "dispute";
let currentThreadId = null;
let currentThreadListing = null;

// Message editing
let activeMessageIndex = null;
let editingMessageIndex = null;
let activeThreadForDelete = null;

// Message replying
let replyingToMessageIndex = null;

// Caches — populated from Firestore. All reads use these.
let allListingsCache = [];
let allOrdersCache = [];
let allThreadsCache = [];

// Block cache — populated once auth resolves
// Raw (unfiltered) listings — updated by the Firestore subscription.
// Filtered cache (allListingsCache) is derived from this after the
// block list is known.
let allListingsRawCache = [];

// Recompute the filtered listing view. Call whenever:
//   - raw listings change (Firestore)
//   - block list changes (block / unblock)
function recomputeFilteredListings() {
  if (!Array.isArray(allListingsRawCache)) allListingsRawCache = [];
  let items = allListingsRawCache.slice();

  // Apply block filter
  if (_blockedUsersLoaded) {
    items = filterOutBlockedSellers(items);
  }

  allListingsCache = items;
}
let _blockedUsersCache = [];
let _blockedUsersLoaded = false;
let _blockedUsersUnsubscribe = null;

// Auth
// Logout lock — prevents Firebase from re-restoring the user during sign-out
let _logoutInProgress = false;
let currentAuthUser = null;
let _authReady = false;
let _isAdminCache = null;   // cached admin status for this session  // true once Firebase has told us who's logged in (or not)
// Reset the block cache so the next user starts fresh
_blockedUsersLoaded = false;
_blockedUsersCache = [];
if (_blockedUsersUnsubscribe) { try { _blockedUsersUnsubscribe(); } catch (e) {} _blockedUsersUnsubscribe = null; }
let authMode = "signup";

// ============================================
// SUB-CATEGORIES — data
// ============================================
const SUB_CATEGORIES = {
  "📱 Phones & Tablets": ["iPhone", "Samsung", "Tecno", "Infinix", "Tablets", "Accessories", "Other"],
  "💻 Electronics": ["Laptops", "TVs", "Audio", "Cameras", "Gaming", "Other"],
  "👗 Fashion": ["Men's", "Women's", "Shoes", "Bags", "Jewelry", "Other"],
  "🪑 Home & Furniture": ["Furniture", "Kitchen", "Decor", "Appliances", "Other"],
  "🚗 Vehicles": ["Cars", "Motorcycles", "Parts", "Other"],
  "🏠 Property": ["Rentals", "For Sale", "Land", "Other"],
  "🛠️ Services": ["Home", "Tech", "Events", "Other"],
  "🧸 Kids & Toys": ["Toys", "Kids Clothing", "Gear", "Other"],
  "📚 Books & Education": ["Textbooks", "Novels", "Stationery", "Other"],
  "💄 Health & Beauty": ["Skincare", "Makeup", "Hair", "Other"],
  "🍔 Food & Beverages": ["Groceries", "Drinks", "Snacks", "Other"],
  "🐾 Pets & Animals": ["Dogs", "Cats", "Birds", "Pet Food", "Other"]
};

// Populates the sub-category dropdown based on the chosen main category.
// Shows the wrapper if there are sub-categories, hides it otherwise.
function updateSubCategoryDropdown(preselect) {
  const catEl = document.getElementById("itemCategory");
  const wrap = document.getElementById("subCategoryWrap");
  const subEl = document.getElementById("itemSubCategory");
  if (!catEl || !wrap || !subEl) return;
  
  const category = catEl.value;
  const subs = SUB_CATEGORIES[category] || [];

  // Clear existing options
  subEl.innerHTML = '<option value="">Select sub-category</option>';

  // No sub-categories → hide the wrapper
  if (subs.length === 0) {
    wrap.style.display = "none";
    return;
  }

  // Build the options
  subs.forEach(function (name) {
    const opt = document.createElement("option");
    opt.textContent = name;
    subEl.appendChild(opt);
  });

  wrap.style.display = "block";

  // Preselect if we're editing an existing listing
  if (preselect && subs.indexOf(preselect) !== -1) {
    subEl.value = preselect;
  }
}

// Change this to your own email to inherit legacy test data on first signup.
const MIGRATION_OWNER_EMAIL = "acquahalfred50@gmail.com";

// The platform owner — the only account that can manage moderators.
const OWNER_UID = "7Ft51pA9TIPfVqIAYwKhzkPEgpq1";

// Is the currently signed-in user the platform owner?
function isCurrentUserOwner() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  return !!(user && user.uid === OWNER_UID);
}


// Returns an inline SVG location pin, styled to match the app.
function locationIcon() {
  return '<svg class="card-meta-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
}

// ============================================
// UTILITIES
// ============================================
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTitle(text) {
  if (!text) return "";
  const specialCases = {
    "iphone": "iPhone", "ipad": "iPad", "ipod": "iPod", "imac": "iMac",
    "macbook": "MacBook", "airpods": "AirPods", "samsung": "Samsung",
    "playstation": "PlayStation", "ps5": "PS5", "ps4": "PS4",
    "xbox": "Xbox", "nintendo": "Nintendo", "hp": "HP", "lg": "LG",
    "tv": "TV", "led": "LED", "lcd": "LCD", "usb": "USB", "hdmi": "HDMI",
    "wifi": "WiFi", "4k": "4K", "8k": "8K", "dvd": "DVD", "cd": "CD",
    "pc": "PC", "ac": "AC"
  };
  return text.trim().split(/\s+/).map(function(word) {
    const lower = word.toLowerCase();
    if (specialCases[lower]) return specialCases[lower];
    if (/^[A-Z]{2,4}$/.test(word)) return word;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

function timeAgo(timestamp) {
  if (!timestamp) return "";
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);

  if (diff < 60) return "just now";

  const mins = Math.floor(diff / 60);
  if (diff < 3600) return mins + " min" + (mins === 1 ? "" : "s") + " ago";

  const hours = Math.floor(diff / 3600);
  if (diff < 86400) return hours + " hour" + (hours === 1 ? "" : "s") + " ago";

  const days = Math.floor(diff / 86400);
  if (diff < 604800) return days + " day" + (days === 1 ? "" : "s") + " ago";

  const weeks = Math.floor(diff / 604800);
  if (diff < 2592000) return weeks + " week" + (weeks === 1 ? "" : "s") + " ago";

  const months = Math.floor(diff / 2592000);
  if (diff < 31536000) return months + " month" + (months === 1 ? "" : "s") + " ago";

  const years = Math.floor(diff / 31536000);
  return years + " year" + (years === 1 ? "" : "s") + " ago";
}

function formatDeadline(deadlineMs, actionLabel) {
  if (!deadlineMs) return "";
  const now = Date.now();
  const diff = deadlineMs - now;

  // Already expired
  if (diff <= 0) {
    return "⚠️ " + actionLabel + " time expired";
  }

  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const totalMinutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  // Urgency tiers
  let icon;
  if (days >= 3) icon = "⏳";
  else if (days >= 1) icon = "🕐";
  else if (hours >= 1) icon = "⚠️";
  else icon = "🚨";

  let timeStr;
  if (days >= 2) {
    timeStr = days + " day" + (days === 1 ? "" : "s");
  } else if (days === 1) {
    timeStr = "1 day " + hours + " hour" + (hours === 1 ? "" : "s");
  } else if (hours >= 1) {
    timeStr = hours + " hour" + (hours === 1 ? "" : "s");
  } else {
    timeStr = totalMinutes + " minute" + (totalMinutes === 1 ? "" : "s");
  }

  return icon + " " + timeStr + " left to " + actionLabel;
}

function getDisputeForListing(listingId) {
  return allOrdersCache.find(function(o) {
    return o.itemId === listingId && o.status === "disputed";
  }) || null;
}

function getOrderCountdown(order) {
  if (!order) return "";

  const status = order.status || "";

  // Terminal states — no countdown needed
  if (status === "Funds released to seller") return "";
  if (status === "refunded") return "";
  if (status === "disputed") return "";
  if (status === "returnRequested") return "";

  // Ship window is active (buyer paid, seller hasn't shipped yet)
  if (status === "Paid — funds held in escrow") {
    if (!order.shipDeadline) return "";
    return formatDeadline(order.shipDeadline, "ship");
  }

  // Confirm window is active (seller shipped, buyer hasn't confirmed)
  if (status === "Shipped — on the way") {
    if (!order.confirmDeadline) return "";
    return formatDeadline(order.confirmDeadline, "confirm delivery");
  }

  return "";
}

// ============================================
// FIRESTORE HELPERS
// ============================================
async function getFsModules() {
  const fb = window.marketaFirebase;
  if (!fb || !fb.db) throw new Error("Firebase not initialized");
  const mod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  return { db: fb.db, ...mod };
}

// Keeps the home page live — updates whenever any listing changes.
let listingsUnsubscribe = null;

// ============================================
// LISTINGS LOCAL CACHE
// ============================================
// Saves the last-known listings to localStorage so the
// homepage renders instantly on next launch — before
// Firebase even responds. Firestore then overwrites it.

const LISTINGS_CACHE_KEY = "marketaListingsCache";

function saveListingsToCache(items) {
  if (!Array.isArray(items)) return;
  try {
    localStorage.setItem(LISTINGS_CACHE_KEY, JSON.stringify(items));
  } catch (e) {
    // Quota exceeded or private mode — silently skip
  }
}

function loadListingsFromCache() {
  try {
    const raw = localStorage.getItem(LISTINGS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    return [];
  }
}

async function loadListingsFromFirestore() {
  // One-time read for the initial render
  const { db, collection, getDocs } = await getFsModules();
  const snap = await getDocs(collection(db, "listings"));
  const items = [];
  snap.forEach(function(docSnap) { items.push(docSnap.data()); });
  items.sort(function(a, b) {
  // 1. Promoted items (that haven't expired) float to the top
const aPromo = a.isPromoted && (!a.promotedExpiresAt || a.promotedExpiresAt > Date.now());
const bPromo = b.isPromoted && (!b.promotedExpiresAt || b.promotedExpiresAt > Date.now());

if (aPromo && !bPromo) return -1;
if (!aPromo && bPromo) return 1;
  
  // 2. If both are promoted (or both normal), sort by newest
  const aT = a.postedAt || Number(a.id) || 0;
  const bT = b.postedAt || Number(b.id) || 0;
  return bT - aT;
});
      allListingsRawCache = items;
      saveListingsToCache(items);   // ← remember for next launch
      recomputeFilteredListings();
      return allListingsCache;
}

async function subscribeToListings() {
  // Stop any previous subscription first
  if (listingsUnsubscribe) {
    listingsUnsubscribe();
    listingsUnsubscribe = null;
  }

  try {
    const { db, collection, onSnapshot } = await getFsModules();
    listingsUnsubscribe = onSnapshot(
      collection(db, "listings"),
      function(snap) {
        const items = [];
        snap.forEach(function(docSnap) { items.push(docSnap.data()); });
        items.sort(function(a, b) {
  // 1. Promoted items always float to the top
  if (a.isPromoted && !b.isPromoted) return -1;
  if (!a.isPromoted && b.isPromoted) return 1;
  
  // 2. If both are promoted (or both normal), sort by newest
  const aT = a.postedAt || Number(a.id) || 0;
  const bT = b.postedAt || Number(b.id) || 0;
  return bT - aT;
});

        allListingsRawCache = items;
saveListingsToCache(items);   // ← cache raw for next launch
recomputeFilteredListings();
        // Re-render only if the home page is currently visible
        const listingsDiv = document.querySelector(".listings");
const shopModalEl = document.getElementById("shopModal");
const shopOpen = shopModalEl && shopModalEl.style.display === "flex";
const detailOpen = document.getElementById("detailModal").classList.contains("show");

        if (listingsDiv && !shopOpen && !detailOpen) {
          renderListings(items);
        }
        // If My Shop is open, refresh it too so deletions/edits show up
        if (shopOpen) {
          openShop();
        }
        // If the search page is open, re-run the search
const searchPageOpen = document.getElementById("searchPage").style.display === "flex";
if (searchPageOpen) {
  searchPageQuery();
}
// If the detail modal is open, refresh the related products
const detailModalOpen = document.getElementById("detailModal").classList.contains("show");
if (detailModalOpen) {
  const currentItem = allListingsCache[currentItemIndex];
  if (currentItem && typeof renderRelatedProducts === "function") {
    renderRelatedProducts(currentItem);
  }
}
// If the profile page is open, refresh its listings count
const profileOpen = document.getElementById("profilePage").style.display === "flex";
if (profileOpen && currentAuthUser && typeof loadProfileStats === "function") {
  loadProfileStats(currentAuthUser.uid).catch(function(e) { console.warn(e); });
}

// If the wishlist page is open, refresh the grid
const wishlistOpen = document.getElementById("wishlistPage").style.display === "flex";
if (wishlistOpen && typeof refreshWishlistGrid === "function") {
  refreshWishlistGrid();
}

// If the user listings page is open, refresh it
const userListingsOpen = document.getElementById("userListingsPage").style.display === "flex";
if (userListingsOpen) {
  const title = document.getElementById("userListingsTitle");
  const uid = userListingsOpen && title ? title.dataset.uid : null;
  if (uid && typeof openUserListingsPage === "function") {
    openUserListingsPage(uid, title.textContent);
  }
}
      },
      function(err) {
        console.warn("Listings subscription error:", err);
      }
    );
  } catch (err) {
    console.warn("Could not subscribe to listings:", err);
  }
}

async function loadOrdersFromFirestore() {
  if (!currentAuthUser) return [];
  const { db, collection, getDocs, query, where } = await getFsModules();

  // Two narrow queries: orders where I'm the buyer, and where I'm the seller.
  const buyerQ = query(collection(db, "orders"), where("buyerId", "==", currentUserId));
  const sellerQ = query(collection(db, "orders"), where("sellerId", "==", currentUserId));

  const [buyerSnap, sellerSnap] = await Promise.all([
    getDocs(buyerQ),
    getDocs(sellerQ)
  ]);

  const merged = {};
  buyerSnap.forEach(function(docSnap) {
    const o = docSnap.data();
    merged[o.ref] = o;
  });
  sellerSnap.forEach(function(docSnap) {
    const o = docSnap.data();
    merged[o.ref] = o;
  });

  const items = Object.values(merged);
  items.sort(function(a, b) {
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  allOrdersCache = items;
  return items;
}

// Keeps My Orders + My Shop live — updates whenever an order changes.
let ordersUnsubscribers = [];

// Tracks the last status we've seen for each order, so we can
// detect *changes* and fire notifications only when something
// actually happened (not on every subscribe re-fire).
// Format: { orderRef: { status, notifiedAt } }
const _lastSeenOrderStatus = {};

// Called from the orders subscription whenever the bucket refreshes.
// Walks through the orders and notifies on transitions we care about.
function checkOrdersForNotifications(items) {
  if (!Array.isArray(items)) return;

  items.forEach(function (order) {
    if (!order || !order.ref) return;

    const prev = _lastSeenOrderStatus[order.ref];
    const curStatus = order.status || "";

    // First time we see this order → record status, don't notify
    if (!prev) {
      _lastSeenOrderStatus[order.ref] = { status: curStatus };
      return;
    }

    // No change → nothing to do
    if (prev.status === curStatus) return;

    const wasStatus = prev.status;
    _lastSeenOrderStatus[order.ref] = { status: curStatus };

    // ----- Which notification fits this transition? -----
    // We only notify for changes that affect ME in a useful way.
    // A buyer doesn't need to be notified that they placed their
    // own order — but they DO need to know if it's shipped or refunded.
    // A seller doesn't need to be notified that THEY marked it as
    // shipped — but they DO need to know a new order arrived, or
    // that delivery was confirmed, or a refund was issued.

    const myUid = currentUserId;
    const iAmBuyer = (order.buyerId === myUid);
    const iAmSeller = (order.sellerId === myUid);

    // Seller: new order arrived (from "no status" → "Paid")
    //         This happens on first creation, which the seller
    //         sees via the subscription.
    if (iAmSeller && !wasStatus && curStatus === "Paid — funds held in escrow") {
      notifySellerNewOrder(order);
      return;
    }

    // Buyer: order shipped
    if (iAmBuyer && wasStatus === "Paid — funds held in escrow" && curStatus === "Shipped — on the way") {
      notifyBuyerShipped(order);
      return;
    }

    // Seller: buyer confirmed delivery
    if (iAmSeller && wasStatus === "Shipped — on the way" && curStatus === "Funds released to seller") {
      notifySellerConfirmed(order);
      return;
    }

    // Buyer: refund issued
    if (iAmBuyer && wasStatus !== "refunded" && curStatus === "refunded") {
      notifyBuyerRefunded(order);
      return;
    }

    // Either side: dispute opened
    if (wasStatus !== "disputed" && curStatus === "disputed") {
      notifyDisputeOpened(order, iAmBuyer ? "buyer" : "seller");
      return;
    }
  });
}

async function subscribeToOrders() {
  // Clean up any previous subscription first
  ordersUnsubscribers.forEach(function(unsub) { try { unsub(); } catch(e){} });
  ordersUnsubscribers = [];

  if (!currentAuthUser) return;

  try {
    const { db, collection, query, where, onSnapshot } = await getFsModules();

    const buyerQ = query(collection(db, "orders"), where("buyerId", "==", currentUserId));
    const sellerQ = query(collection(db, "orders"), where("sellerId", "==", currentUserId));

    // Shared bucket — updated by both snapshots
    const bucket = { buyer: [], seller: [] };

function renderFromBucket() {
  const merged = {};
  bucket.buyer.forEach(function(o) { merged[o.ref] = o; });
  bucket.seller.forEach(function(o) { merged[o.ref] = o; });
  const items = Object.values(merged);
  items.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  allOrdersCache = items;

  // Check for status transitions that need a notification
  checkOrdersForNotifications(items);

  // Auto-refresh whichever view is open
// NOTE: these modals use style.display = "flex", not a .show class.
const ordersModalEl = document.getElementById("ordersModal");
const shopModalEl = document.getElementById("shopModal");
const ordersOpen = ordersModalEl && ordersModalEl.style.display === "flex";
const shopOpen = shopModalEl && shopModalEl.style.display === "flex";
  if (ordersOpen) {
    // --- Snapshot open cards + scroll position before re-rendering ---
    const openDetails = [];
    document.querySelectorAll('#ordersModal .order-details').forEach(function(el) {
      if (el.style.display === "block") openDetails.push(el.id);
    });
    const modalBody = document.querySelector("#ordersModal .modal-body");
    const scrollTop = modalBody ? modalBody.scrollTop : 0;

    openOrders().then(function() {
      // Reopen previously-expanded cards
      openDetails.forEach(function(id) {
        const el = document.getElementById(id);
        if (el) {
          el.style.display = "block";
          const chev = document.getElementById("chev-" + id);
          if (chev) chev.textContent = "▾";
        }
      });
      // Restore scroll position
      const mb = document.querySelector("#ordersModal .modal-body");
      if (mb) mb.scrollTop = scrollTop;
    });
  }

  if (shopOpen) {
    const openShopDetails = [];
    document.querySelectorAll('#shopModal .order-details').forEach(function(el) {
      if (el.style.display === "block") openShopDetails.push(el.id);
    });
    const shopBody = document.querySelector("#shopModal .modal-body");
    const shopScrollTop = shopBody ? shopBody.scrollTop : 0;

    openShop().then(function() {
      openShopDetails.forEach(function(id) {
        const el = document.getElementById(id);
        if (el) {
          el.style.display = "block";
          const chev = document.getElementById("chev-" + id);
          if (chev) chev.textContent = "▾";
        }
      });
      const mb = document.querySelector("#shopModal .modal-body");
      if (mb) mb.scrollTop = shopScrollTop;
    });
  }
}

    const unsubBuyer = onSnapshot(buyerQ, function(snap) {
      const arr = [];
      snap.forEach(function(d) { arr.push(d.data()); });
      bucket.buyer = arr;
      renderFromBucket();
    }, function(err) {
      console.warn("Buyer orders subscription error:", err);
    });

    const unsubSeller = onSnapshot(sellerQ, function(snap) {
      const arr = [];
      snap.forEach(function(d) { arr.push(d.data()); });
      bucket.seller = arr;
      renderFromBucket();
    }, function(err) {
      console.warn("Seller orders subscription error:", err);
    });

    ordersUnsubscribers = [unsubBuyer, unsubSeller];
  } catch (err) {
    console.warn("Could not subscribe to orders:", err);
  }
}

// ============================================
// THREADS (buyer ↔ seller chats) — Firestore
// ============================================
async function loadThreadsFromFirestore() {
  if (!currentAuthUser) return [];
  const { db, collection, getDocs, query, where } = await getFsModules();

  // Two narrow queries: threads where I'm the buyer, and where I'm the seller.
  const buyerQ = query(collection(db, "threads"), where("buyerId", "==", currentUserId));
  const sellerQ = query(collection(db, "threads"), where("sellerId", "==", currentUserId));

  const [buyerSnap, sellerSnap] = await Promise.all([
    getDocs(buyerQ),
    getDocs(sellerQ)
  ]);

  const merged = {};
  buyerSnap.forEach(function(docSnap) {
    const t = docSnap.data();
    merged[t.id] = t;
  });
  sellerSnap.forEach(function(docSnap) {
    const t = docSnap.data();
    merged[t.id] = t;
  });

  const items = Object.values(merged);
  allThreadsCache = items;
  return items;
}

// Keeps the Messages inbox live — updates whenever a thread changes.
let threadsUnsubscribers = [];

// Tracks the last message we've already "seen" per thread,
// so we don't fire a notification twice for the same message.
// Format: { threadId: lastMessageAtMs }
const _lastSeenMessageMs = {};

// Checks a freshly-updated thread for a new message we should
// notify about. Called from subscribeToThreads whenever a
// thread snapshot arrives.
function checkThreadForNewMessage(thread) {
  if (!thread || !thread.id) return;

  const prevMs = _lastSeenMessageMs[thread.id] || 0;
  const curMs = thread.lastMessageAtMs
    || (thread.lastMessageAt ? new Date(thread.lastMessageAt).getTime() : 0)
    || 0;

  // Nothing new since last time we checked
  if (curMs <= prevMs) {
    return;
  }

  // First time we see this thread — record its timestamp but don't notify.
  // (Prevents a burst of notifications on first inbox load.)
  if (prevMs === 0) {
    _lastSeenMessageMs[thread.id] = curMs;
    return;
  }

  // It IS new — figure out who sent it
  _lastSeenMessageMs[thread.id] = curMs;

  const messages = thread.messages || [];
  if (messages.length === 0) return;

  const last = messages[messages.length - 1];
  if (!last) return;

  const myRole = (thread.sellerId === currentUserId) ? "seller" : "buyer";

  // Don't notify for our own messages
  if (last.from === myRole) return;

  // Don't notify if we're currently IN this thread
  if (chatMode === "bs" && currentThreadId === thread.id) return;

  // Compose the notification
  const listing = allListingsCache.find(function (l) {
    return l.id === thread.listingId;
  });
  const listingName = listing ? formatTitle(listing.name) : "a listing";

  const senderId = (myRole === "buyer") ? thread.sellerId : thread.buyerId;

  // Preview text
  let preview = "";
  if (last.deleted) preview = "Message deleted";
  else if (last.text) preview = last.text;
  else if (last.img) preview = "📷 Photo";

  if (preview.length > 60) preview = preview.slice(0, 60) + "…";

  // Look up the sender's name (cached after first call).
  // If we already have it cached, use it synchronously.
  if (senderId && _userNameCache[senderId]) {
    sendAppNotification(
      "💬 " + _userNameCache[senderId],
      preview + " · " + listingName,
      "thread-" + thread.id
    );
    return;
  }

  // Otherwise, look it up async — the toast will appear ~50ms later,
  // which is imperceptible.
  if (senderId) {
    getDisplayNameByUid(senderId).then(function (name) {
      sendAppNotification(
        "💬 " + (name || "New message"),
        preview + " · " + listingName,
        "thread-" + thread.id
      );
    }).catch(function () {
      sendAppNotification(
        "💬 New message",
        preview + " · " + listingName,
        "thread-" + thread.id
      );
    });
  } else {
    sendAppNotification(
      "💬 New message",
      preview + " · " + listingName,
      "thread-" + thread.id
    );
  }
}

async function subscribeToThreads() {
  // Clean up any previous subscription first
  threadsUnsubscribers.forEach(function(unsub) { try { unsub(); } catch(e){} });
  threadsUnsubscribers = [];

  if (!currentAuthUser) return;

  try {
    const { db, collection, query, where, onSnapshot } = await getFsModules();

    const buyerQ = query(collection(db, "threads"), where("buyerId", "==", currentUserId));
    const sellerQ = query(collection(db, "threads"), where("sellerId", "==", currentUserId));

    const bucket = { buyer: [], seller: [] };

function renderFromBucket() {
  const merged = {};
  bucket.buyer.forEach(function(t) { merged[t.id] = t; });
  bucket.seller.forEach(function(t) { merged[t.id] = t; });
  const items = Object.values(merged);
  allThreadsCache = items;

  // Check each thread for a new message (fires notifications)
  items.forEach(function (t) {
    checkThreadForNewMessage(t);
  });

     // Refresh inbox if open
// NOTE: the messagesModal uses style.display = "flex", not a class.
const messagesModal = document.getElementById("messagesModal");
const messagesOpen = messagesModal && messagesModal.style.display === "flex";
if (messagesOpen) openMessages();
// Refresh the header badge with the latest unread count
updateMessagesBadge();

      // Refresh the currently-open chat if its thread was updated
if (chatMode === "bs" && currentThreadId) {
  const updated = merged[currentThreadId];
  if (updated) {
    // If the user is actively viewing this thread, mark all
    // messages as read up to the newest one.
    const myRole = (updated.sellerId === currentUserId) ? "seller" : "buyer";
    const lastMsg = (updated.messages || [])[updated.messages.length - 1];
    const newestAt = lastMsg && lastMsg.sentAt ? lastMsg.sentAt : Date.now();

    if (!updated.lastReadBy) updated.lastReadBy = {};
    const alreadyRead = updated.lastReadBy[myRole] || 0;

    if (newestAt > alreadyRead) {
      updated.lastReadBy[myRole] = newestAt;
      saveThreadToFirestore(updated).catch(function (e) {
        console.warn("Failed to update read time:", e);
      });
    }

    renderThread();
  }
}
    }

    const unsubBuyer = onSnapshot(buyerQ, function(snap) {
      const arr = [];
      snap.forEach(function(d) { arr.push(d.data()); });
      bucket.buyer = arr;
      renderFromBucket();
    }, function(err) {
      console.warn("Buyer threads subscription error:", err);
    });

    const unsubSeller = onSnapshot(sellerQ, function(snap) {
      const arr = [];
      snap.forEach(function(d) { arr.push(d.data()); });
      bucket.seller = arr;
      renderFromBucket();
    }, function(err) {
      console.warn("Seller threads subscription error:", err);
    });

    threadsUnsubscribers = [unsubBuyer, unsubSeller];
  } catch (err) {
    console.warn("Could not subscribe to threads:", err);
  }
}

async function saveThreadToFirestore(thread) {
  const { db, doc, setDoc } = await getFsModules();
  await setDoc(doc(db, "threads", String(thread.id)), thread);
}

async function deleteThreadFromFirestore(threadId) {
  const { db, doc, deleteDoc } = await getFsModules();
  await deleteDoc(doc(db, "threads", String(threadId)));
}

async function saveOrderToFirestore(order) {
  const { db, doc, setDoc } = await getFsModules();
  await setDoc(doc(db, "orders", String(order.ref)), order);
}

async function deleteOrderFromFirestore(ref) {
  const { db, doc, deleteDoc } = await getFsModules();
  await deleteDoc(doc(db, "orders", String(ref)));
}

// ============================================
// AUTH
// ============================================
async function getAuthModule() {
  const fb = window.marketaFirebase;
  if (!fb || !fb.auth) throw new Error("Firebase Auth not initialized");
  const mod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  return { auth: fb.auth, ...mod };
}

// Show a loading placeholder immediately when the page opens.
function showStartupLoading() {
  const listingsDiv = document.querySelector(".listings");
  if (!listingsDiv) return;

  let html = "";
  for (let i = 0; i < 6; i++) {
    html +=
      '<div class="listing skeleton-card" aria-hidden="true">' +
        '<div class="skeleton-thumb shimmer"></div>' +
        '<div class="card-body">' +
          '<div class="skeleton-line shimmer" style="width: 90%; height: 12px;"></div>' +
          '<div class="skeleton-line shimmer" style="width: 65%; height: 12px;"></div>' +
          '<div class="skeleton-line shimmer" style="width: 50%; height: 10px; margin-top: 4px;"></div>' +
          '<div class="skeleton-price shimmer" style="width: 45%; height: 16px; margin-top: 6px;"></div>' +
        '</div>' +
      '</div>';
  }
  listingsDiv.innerHTML = html;
}

// On startup, try to render from the local cache immediately.
// This gives the user instant listings before Firebase responds.
// If the cache is empty (first launch), fall back to skeletons.
(function renderFromCacheOrSkeleton() {
  const cached = loadListingsFromCache();
  if (cached && cached.length > 0) {
    allListingsRawCache = cached;
    recomputeFilteredListings();
    // Wait until the DOM is ready for the grid to exist
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function() {
        renderListings(cached);
      });
    } else {
      renderListings(cached);
    }
  } else {
    showStartupLoading();
  }
})();

async function initAuth() {
  try {
    const searchBox = document.getElementById("searchBox");
    if (searchBox) searchBox.value = "";

    const { auth, onAuthStateChanged } = await getAuthModule();
    onAuthStateChanged(auth, async function(user) {
// Ignore stale user during logout
if (_logoutInProgress) {
  if (user) return; // skip — we're logging out
  _logoutInProgress = false; // Firebase finally cleared it
}

// Firebase has now told us the truth — hide the loading state
_authReady = true;

if (user) {
    currentAuthUser = user;
        currentUserId = user.uid;
        localStorage.setItem("marketaUserId", user.uid);
        localStorage.setItem("marketaUserEmail", user.email || "");
        const searchBox = document.getElementById("searchBox");
        if (searchBox) searchBox.value = "";
        document.getElementById("authModal").classList.remove("show");
        await migrateLegacyDataIfNeeded(user);
        // Save/update this user's name in Firestore so others can see it
saveUserProfileToFirestore(user).catch(function(e) { console.warn(e); });
await applyModeratorAccessForUser(user).catch(function(e) { console.warn(e); });
        await loadListingsFromFirestore().catch(function(e) { console.warn(e); });
        await subscribeToListings().catch(function(e) { console.warn(e); });
        await subscribeToOrders().catch(function(e) { console.warn(e); });
        await subscribeToThreads().catch(function(e) { console.warn(e); });
        await subscribeToFollows().catch(function(e) { console.warn(e); });
        await subscribeToWishlist().catch(function(e) { console.warn(e); });
        await subscribeToIncomingFollows().catch(function(e) { console.warn(e); });
        await subscribeToMyReviews().catch(function(e) { console.warn(e); });
        await loadBlockedUsersFromFirestore().catch(function(e) { console.warn(e); });
        await subscribeToBlockedUsers().catch(function(e) { console.warn(e); });
        await subscribeToTickets().catch(function(e) { console.warn(e); });
        setTimeout(updateMessagesBadge, 500);
        updateHeaderAuth();
        await loadOrdersFromFirestore().catch(function(e) { console.warn(e); });
        await loadThreadsFromFirestore().catch(function(e) { console.warn(e); });
        await runAutoTimeoutCheck().catch(function(e) { console.warn(e); });
        renderListings(allListingsCache);
        
// Restore the last location ONLY on a real in-tab
// refresh — NOT on a fresh app launch. This way:
//   • Pull-down / ⟳ refresh → you stay on your screen
//   · Close + reopen app    → you land on Home
//
// When we ARE restoring, we hold the homepage render
// back a touch so the overlay + the incoming screen
// feel like one continuous transition, rather than
// the homepage "snapping" in behind the overlay.
// Only bother restoring when there's actually something
// to restore — otherwise a refresh on Home would leave
// the overlay stuck with nothing to hide it.
const _savedLocation = loadLastLocation();
const _willRestore = (
  typeof restoreLastLocation === "function" &&
  wasReload() &&
  !!_savedLocation
);

if (_willRestore) {
  showRestoreOverlay();
  hideHomeForRestore();
  setTimeout(function () {
    restoreLastLocation().catch(function(e) { console.warn(e); });
  }, 0);
}

} else {
  currentAuthUser = null;
  updateHeaderAuth();

  // Free browsing — no forced login.
  // Listings load for everyone. Only actions need a login.

  // Reset auth modal internals so it opens cleanly next time
  const _loading = document.getElementById("authLoading");
  const _forms = document.getElementById("authForms");
  if (_loading) _loading.style.display = "none";
  if (_forms) _forms.style.display = "block";

  // Clear any leftover input values
  const emailInput = document.getElementById("authEmail");
  const pwdInput = document.getElementById("authPassword");
  const nameInput = document.getElementById("authDisplayName");
  if (emailInput) emailInput.value = "";
  if (pwdInput) pwdInput.value = "";
  if (nameInput) nameInput.value = "";

  const errEl = document.getElementById("authError");
  if (errEl) errEl.style.display = "none";

  switchAuthTab("signup");

  // Load and render listings for guests
  await loadListingsFromFirestore().catch(function(e) { console.warn(e); });
  await subscribeToListings().catch(function(e) { console.warn(e); });
  renderListings(allListingsCache);
}
});
  } catch (err) {
    console.error("Auth init failed:", err);
    document.getElementById("authModal").classList.remove("show");
    loadListings();
  }
}

function switchAuthTab(mode) {
  if (mode) {
    authMode = mode;
  } else {
    authMode = (authMode === "signup") ? "login" : "signup";
  }
  const isSignup = authMode === "signup";

  document.getElementById("authDisplayName").style.display = isSignup ? "block" : "none";
  document.getElementById("authSubmitBtn").textContent = isSignup ? "Create account" : "Log In";
  document.getElementById("authTitle").textContent = isSignup ? "Welcome to Marketa" : "Welcome back";
  document.getElementById("authSwitchText").textContent = isSignup ? "Already have an account?" : "Need an account?";
  document.getElementById("authSwitchLink").textContent = isSignup ? "Log in" : "Sign up";
  document.getElementById("authError").style.display = "none";
}

async function submitAuth() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const displayName = document.getElementById("authDisplayName").value.trim();
  const errEl = document.getElementById("authError");

  errEl.style.display = "none";

  if (!email || !password) {
    errEl.textContent = "Email and password are required.";
    errEl.style.display = "block";
    return;
  }
  if (password.length < 6) {
    errEl.textContent = "Password must be at least 6 characters.";
    errEl.style.display = "block";
    return;
  }
  if (authMode === "signup" && !displayName) {
    errEl.textContent = "Please enter your name.";
    errEl.style.display = "block";
    return;
  }

  try {
    const mod = await getAuthModule();
    if (authMode === "signup") {
      const cred = await mod.createUserWithEmailAndPassword(mod.auth, email, password);
      if (displayName && cred.user) {
        await mod.updateProfile(cred.user, { displayName: displayName });
      }

      // New account — ask about notifications after a short delay
      setTimeout(function () {
        if (typeof showNotifAskDialog === "function") {
          showNotifAskDialog();
        }
      }, 1200);

    } else {
      await mod.signInWithEmailAndPassword(mod.auth, email, password);

      // Existing account — also ask if we haven't on this device
      setTimeout(function () {
        if (typeof showNotifAskDialog === "function") {
          showNotifAskDialog();
        }
      }, 1200);
    }
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.style.display = "block";
  }
}

function friendlyAuthError(err) {
  const code = err.code || "";
  if (code.includes("email-already-in-use")) return "This email is already registered. Try logging in.";
  if (code.includes("invalid-email")) return "Please enter a valid email address.";
  if (code.includes("weak-password")) return "Password is too weak. Use at least 6 characters.";
  if (code.includes("user-not-found")) return "No account with this email. Try signing up.";
  if (code.includes("wrong-password")) return "Incorrect password. Try again.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a few minutes.";
  if (code.includes("network-request-failed")) return "Network error. Check your connection.";
  return err.message || "Something went wrong. Please try again.";
}

function logoutUser() {
  marketaConfirm(
    "🚪 Log out",
    "Are you sure you want to log out of Marketa?",
    performLogout,
    null
  );
}

async function performLogout() {
  try {
    _logoutInProgress = true;

// Clear the cached admin status so the next user starts fresh
_isAdminCache = null;

// Close the profile page now that the user confirmed logout
closeProfile();

    if (_wishlistUnsubscribe) { try { _wishlistUnsubscribe(); } catch (e) {} _wishlistUnsubscribe = null; }
    if (_blockedUsersUnsubscribe) { try { _blockedUsersUnsubscribe(); } catch (e) {} _blockedUsersUnsubscribe = null; }
    if (_ticketsUnsubscribe) { try { _ticketsUnsubscribe(); } catch (e) {} _ticketsUnsubscribe = null; }
    const mod = await getAuthModule();
    await mod.signOut(mod.auth);

    // Explicitly clear our state
    currentAuthUser = null;
    currentUserId = null;
    localStorage.removeItem("marketaUserId");
    localStorage.removeItem("marketaUserEmail");

    // Clear inputs
    const emailInput = document.getElementById("authEmail");
    const pwdInput = document.getElementById("authPassword");
    const nameInput = document.getElementById("authDisplayName");
    if (emailInput) emailInput.value = "";
    if (pwdInput) pwdInput.value = "";
    if (nameInput) nameInput.value = "";

    // Close any open pages/modals
    closeShop();
    closeProfile();
    document.querySelectorAll(".modal.show").forEach(function(m) {
      m.classList.remove("show");
    });

    // Clear caches
    allListingsCache = [];
    allOrdersCache = [];

    // Update header + nav
    updateHeaderAuth();
    document.querySelectorAll(".bottom-nav-item").forEach(function(el) {
      el.classList.toggle("active", el.getAttribute("data-tab") === "home");
    });

    marketaToast("Logged out 👋");

    // Refresh listings for guest view
await loadListingsFromFirestore().catch(function(e) { console.warn(e); });
// Guest view has no blocked list — allow the grid to render
_blockedUsersLoaded = true;
renderListings(allListingsCache);

    // Release the lock after 3 seconds (allow fresh login)
    setTimeout(function() { _logoutInProgress = false; }, 5000);

  } catch (err) {
    _logoutInProgress = false;
    marketaAlert("❌ Error", "Failed to log out: " + err.message);
  }
}

async function migrateLegacyDataIfNeeded(user) {
  if (!user || !user.email) return;
  if (user.email !== MIGRATION_OWNER_EMAIL) return;
  if (localStorage.getItem("marketaLegacyMigrated") === "yes") return;

  const legacyIds = ["user_testA", "user_testB", "user_legacy"];

  try {
    const { db, collection, getDocs, doc, setDoc } = await getFsModules();

    const listingsSnap = await getDocs(collection(db, "listings"));
    let migratedCount = 0;
    for (const docSnap of listingsSnap.docs) {
      const data = docSnap.data();
      if (legacyIds.includes(data.sellerId)) {
        data.sellerId = user.uid;
        await setDoc(doc(db, "listings", docSnap.id), data);
        migratedCount++;
      }
    }

    localStorage.setItem("marketaLegacyMigrated", "yes");
    console.log("Migrated " + migratedCount + " listings.");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

// ============================================
// BUYER ↔ SELLER THREADS (still localStorage)
// ============================================
function loadThreads() {
  return allThreadsCache.slice();
}
async function saveThreads(threads) {
  allThreadsCache = threads.slice();
  // Save only the thread(s) that changed — for now, save all
  for (const thread of threads) {
    try {
      await saveThreadToFirestore(thread);
    } catch (err) {
      console.warn("Failed to save thread:", err);
    }
  }
}
function findThread(listingId, buyerId, sellerId) {
  const threads = loadThreads();
  return threads.find(function(t) {
    return t.listingId === listingId && t.buyerId === buyerId && t.sellerId === sellerId;
  }) || null;
}
async function createThread(listingId, buyerId, sellerId) {
  const thread = {
    id: "thread_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    listingId: listingId,
    buyerId: buyerId,
    sellerId: sellerId,
    messages: [],
    createdAt: new Date().toLocaleString(),
    lastMessageAt: new Date().toLocaleString(),
    createdAtMs: Date.now()
  };
  await saveThreadToFirestore(thread);
  allThreadsCache.push(thread);
  return thread;
}
async function getOrCreateThread(listingId, buyerId, sellerId) {
  let thread = findThread(listingId, buyerId, sellerId);
  if (!thread) thread = await createThread(listingId, buyerId, sellerId);
  return thread;
}
function getMyThreads() {
  return allThreadsCache.filter(function(t) {
    const involved = t.buyerId === currentUserId || t.sellerId === currentUserId;
    if (!involved) return false;
    if (t.deletedFor && t.deletedFor.includes(currentUserId)) return false;
    return true;
  });
}

// ============================================
// THEME (light / dark)
// ============================================
// ============================================
// THEME (light / dark / system)
// ============================================

// Listener for "system" mode — keeps Marketa in sync
// with the phone's dark/light setting.
let _systemThemeListener = null;

function getStoredThemeChoice() {
  const saved = localStorage.getItem("marketaThemeChoice");
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  // Backwards compatibility with the old "marketaTheme" key
  const legacy = localStorage.getItem("marketaTheme");
  if (legacy === "light" || legacy === "dark") return legacy;
  return "system";
}

function applyThemeChoice(choice) {
  // choice = "light" | "dark" | "system"
  localStorage.setItem("marketaThemeChoice", choice);

  if (choice === "system") {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", systemDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", choice);
  }

  updateAppearanceRow();
}

function initTheme() {
  const choice = getStoredThemeChoice();
  applyThemeChoice(choice);

  // If we're in system mode, listen for phone theme changes
  if (choice === "system") {
    attachSystemThemeListener();
  }
}

function attachSystemThemeListener() {
  detachSystemThemeListener();
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  _systemThemeListener = function (e) {
    if (getStoredThemeChoice() !== "system") return;
    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
  };
  if (mq.addEventListener) {
    mq.addEventListener("change", _systemThemeListener);
  } else if (mq.addListener) {
    // Older Safari
    mq.addListener(_systemThemeListener);
  }
}

function detachSystemThemeListener() {
  if (!_systemThemeListener) return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.removeEventListener) {
    mq.removeEventListener("change", _systemThemeListener);
  } else if (mq.removeListener) {
    mq.removeListener(_systemThemeListener);
  }
  _systemThemeListener = null;
}

// --------------------------------------------------
// Quick toggle (still used by the profile menu row)
// --------------------------------------------------
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = (current === "dark") ? "light" : "dark";
  applyThemeChoice(next);
}

// --------------------------------------------------
// Appearance picker
// --------------------------------------------------
function openAppearancePicker() {
  const modal = document.getElementById("appearancePicker");
  if (!modal) return;
  modal.classList.add("show");
  refreshAppearancePickerSelection();
  pushLayer("appearancePicker", closeAppearancePicker);
}

function closeAppearancePicker() {
  const modal = document.getElementById("appearancePicker");
  if (!modal) return;
  modal.classList.remove("show");
  popLayer("appearancePicker");
}

function refreshAppearancePickerSelection() {
  const current = getStoredThemeChoice();
  document.querySelectorAll(".appearance-option").forEach(function (btn) {
    const choice = btn.getAttribute("data-theme-choice");
    btn.classList.toggle("selected", choice === current);
  });
}

function chooseTheme(choice) {
  applyThemeChoice(choice);

  if (choice === "system") {
    attachSystemThemeListener();
  } else {
    detachSystemThemeListener();
  }

  closeAppearancePicker();
  marketaToast("Theme set to " + choice.charAt(0).toUpperCase() + choice.slice(1) + " ✅");
}

// --------------------------------------------------
// Appearance row label (on the Settings page)
// --------------------------------------------------
function updateAppearanceRow() {
  const subEl = document.getElementById("appearanceSub");
  const iconEl = document.getElementById("appearanceIcon");
  if (!subEl) return;

  const choice = getStoredThemeChoice();
  if (choice === "light") {
    subEl.textContent = "Light";
    if (iconEl) iconEl.textContent = "☀️";
  } else if (choice === "dark") {
    subEl.textContent = "Dark";
    if (iconEl) iconEl.textContent = "🌙";
  } else {
    subEl.textContent = "System";
    if (iconEl) iconEl.textContent = "🌗";
  }
}

// ============================================
// SUPPORT TICKETS — state + shell functions
// ============================================
let _ticketSelectedCategory = null;
let _ticketImageData = null;

const TICKET_CATEGORIES = [
  { id: "order",    label: "📦 Order issue" },
  { id: "payment",  label: "💳 Payment / escrow" },
  { id: "account",  label: "👤 Account issue" },
  { id: "listing",  label: "🏷️ Listing / seller" },
  { id: "other",    label: "💬 Something else" }
];

// Opens the new-ticket form (Step 2 wires up its internals).
function openNewTicketForm() {
  // Require login
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) {
    closeSupport();
    openAuthFromHeader();
    return;
  }

  // Reset state
  _ticketSelectedCategory = null;
  _ticketImageData = null;

  // Reset inputs
  const subjectEl = document.getElementById("ticketSubject");
  const descEl = document.getElementById("ticketDescription");
  const counterEl = document.getElementById("ticketDescCounter");
  const errEl = document.getElementById("ticketError");
  const previewEl = document.getElementById("ticketPhotoPreview");
  const fileEl = document.getElementById("ticketImage");

  if (subjectEl) subjectEl.value = "";
  if (descEl) descEl.value = "";
  if (counterEl) counterEl.textContent = "0/1000";
  if (errEl) errEl.style.display = "none";
  if (previewEl) previewEl.innerHTML = "📷";
  if (fileEl) fileEl.value = "";

  // Build the category buttons (idempotent — only once)
  const catList = document.getElementById("ticketCategoryList");
  if (catList && catList.dataset.built !== "yes") {
    catList.dataset.built = "yes";
    catList.innerHTML = "";
    TICKET_CATEGORIES.forEach(function (cat) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ticket-cat-btn";
      btn.setAttribute("data-cat-id", cat.id);
      btn.textContent = cat.label;
      btn.addEventListener("click", function () {
        pickTicketCategory(cat.id);
      });
      catList.appendChild(btn);
    });
  }

  // Wire up the description counter (once)
  if (descEl && descEl.dataset.counterWired !== "yes") {
    descEl.dataset.counterWired = "yes";
    descEl.addEventListener("input", function () {
      const c = document.getElementById("ticketDescCounter");
      if (c) c.textContent = descEl.value.length + "/1000";
    });
  }

  // Show the form
  // Close the Support modal PROPERLY (pop from stack + hide)
// before opening the ticket form.
if (_layerStack.some(function (l) { return l.id === "supportModal"; })) {
  closeSupport();
}

// Show the form
const modal = document.getElementById("newTicketModal");
if (modal) modal.style.display = "flex";

pushLayer("newTicketModal", closeNewTicketForm);
}

// Closes the new-ticket form.
function closeNewTicketForm() {
  const modal = document.getElementById("newTicketModal");
  if (modal) modal.style.display = "none";

  popLayer("newTicketModal");
}

// Highlights the picked category.
function pickTicketCategory(catId) {
  _ticketSelectedCategory = catId;
  document.querySelectorAll("#ticketCategoryList .ticket-cat-btn").forEach(function (btn) {
    btn.classList.toggle("selected", btn.getAttribute("data-cat-id") === catId);
  });
}

// Submits the new ticket to Firestore.
async function submitNewTicket() {
  const errEl = document.getElementById("ticketError");
  if (errEl) errEl.style.display = "none";

  // ---- Validate ----
  if (!_ticketSelectedCategory) {
    if (errEl) {
      errEl.textContent = "Please pick a category first. 🙏";
      errEl.style.display = "block";
    }
    return;
  }

  const subjectEl = document.getElementById("ticketSubject");
  const descEl = document.getElementById("ticketDescription");
  const subject = subjectEl ? subjectEl.value.trim() : "";
  const description = descEl ? descEl.value.trim() : "";

  if (subject.length < 4) {
    if (errEl) {
      errEl.textContent = "Please give your ticket a subject (at least 4 characters).";
      errEl.style.display = "block";
    }
    return;
  }
  if (description.length < 10) {
    if (errEl) {
      errEl.textContent = "Please describe the issue (at least 10 characters).";
      errEl.style.display = "block";
    }
    return;
  }

  // ---- Require login ----
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) {
    closeNewTicketForm();
    openAuthFromHeader();
    return;
  }

  // ---- Find the category label ----
  const cat = TICKET_CATEGORIES.find(function (c) { return c.id === _ticketSelectedCategory; });
  const categoryLabel = cat ? cat.label : "💬 Something else";

  // ---- Build the ticket ----
  const now = Date.now();
  const nowStr = new Date().toLocaleString();
  const userName = liveUser.displayName
    || (liveUser.email ? liveUser.email.split("@")[0] : "User");

  const ticket = {
    userId: liveUser.uid,
    userName: userName,
    userEmail: liveUser.email || "",
    category: _ticketSelectedCategory,
    categoryLabel: categoryLabel,
    subject: subject,
    description: description,
    image: _ticketImageData || null,
    status: "open",
    createdAt: now,
    createdAtStr: nowStr,
    updatedAt: now,
    messages: [
      {
        from: "user",
        text: description,
        img: _ticketImageData || null,
        time: nowStr,
        sentAt: now
      }
    ],
    unreadForAdmin: true,
    unreadForUser: false
  };

  // ---- Save ----
  const submitBtn = document.querySelector("#newTicketModal .buy-btn");
  const originalText = submitBtn ? submitBtn.textContent : "Submit ticket";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
  }

  try {
    const { db, collection, addDoc } = await getFsModules();
    await addDoc(collection(db, "tickets"), ticket);

    // Close + toast
    closeNewTicketForm();
    // Also close the Support modal so the user lands back on the app
    closeSupport();

    marketaToast("Ticket submitted ✅ We'll reply soon");

  } catch (err) {
    console.warn("Ticket submission failed:", err);
    if (errEl) {
      errEl.textContent = "Couldn't submit: " + (err.message || "unknown error");
      errEl.style.display = "block";
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

// ============================================
// MY TICKETS PAGE
// ============================================
let _myTicketsTab = "all";
let _myTicketsCache = [];
let _myTicketsUnsubscribe = null;

// Opens the My Tickets page.
async function openMyTickets() {
  // Require login
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) {
    closeSupport();
    openAuthFromHeader();
    return;
  }
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  const page = document.getElementById("myTicketsPage");
  if (!page) return;

  // Close the Support modal PROPERLY (pop from stack + hide)
  // before opening My Tickets. This avoids two-layer history conflicts.
  if (_layerStack.some(function (l) { return l.id === "supportModal"; })) {
    closeSupport();
  }

  // Reset to "All" tab
  _myTicketsTab = "all";
  document.querySelectorAll(".tickets-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === "all");
  });

  // Show the page
  page.style.display = "flex";
  document.body.classList.add("page-open");

  pushLayer("myTicketsPage", closeMyTickets);

  // Load + render
  await loadMyTickets();
  renderMyTickets();
}

// Closes the My Tickets page.
function closeMyTickets() {
  const page = document.getElementById("myTicketsPage");
  if (page) page.style.display = "none";

  popLayer("myTicketsPage");

  if (!hasAnotherPageOpen("myTicketsPage")) {
    document.body.classList.remove("page-open");
  }
}

// Loads the current user's tickets from Firestore.
async function loadMyTickets() {
  if (!currentUserId) return [];
  try {
    const { db, collection, query, where, getDocs } = await getFsModules();
    const q = query(collection(db, "tickets"), where("userId", "==", currentUserId));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(function (d) {
      const data = d.data();
      data._docId = d.id;
      items.push(data);
    });
    // Newest first
    items.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    _myTicketsCache = items;
    return items;
  } catch (err) {
    console.warn("Load tickets failed:", err);
    _myTicketsCache = [];
    return [];
  }
}

// Tab switching.
function filterMyTickets(tab) {
  _myTicketsTab = tab;
  document.querySelectorAll(".tickets-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  renderMyTickets();
}

// Renders the list, filtered by tab.
function renderMyTickets() {
  const listEl = document.getElementById("myTicketsList");
  const emptyEl = document.getElementById("myTicketsEmpty");
  if (!listEl || !emptyEl) return;

  listEl.innerHTML = "";

  // Filter
  let shown = _myTicketsCache.slice();
  if (_myTicketsTab === "open") {
    shown = shown.filter(function (t) { return t.status !== "resolved"; });
  } else if (_myTicketsTab === "resolved") {
    shown = shown.filter(function (t) { return t.status === "resolved"; });
  }

  // Empty state
  if (shown.length === 0) {
    listEl.style.display = "none";
    emptyEl.style.display = "block";

    // Adjust the empty message per tab
    const titleEl = emptyEl.querySelector(".empty-state-title");
    const textEl = emptyEl.querySelector(".empty-state-text");
    if (_myTicketsTab === "open" && _myTicketsCache.length > 0) {
      if (titleEl) titleEl.textContent = "No open tickets";
      if (textEl) textEl.textContent = "All your tickets are resolved. Nice!";
    } else if (_myTicketsTab === "resolved" && _myTicketsCache.length > 0) {
      if (titleEl) titleEl.textContent = "No resolved tickets";
      if (textEl) textEl.textContent = "Resolved tickets will appear here once we close them.";
    } else {
      if (titleEl) titleEl.textContent = "No tickets yet";
      if (textEl) textEl.textContent = "When you open a support ticket, it will appear here so you can follow along.";
    }
    return;
  }

  listEl.style.display = "flex";
  emptyEl.style.display = "none";

  shown.forEach(function (t) {
    listEl.appendChild(buildTicketRow(t));
  });

  // Update the badge on the Support modal
  updateMyTicketsBadge();
}

// Builds a single ticket row.
function buildTicketRow(ticket) {
  const row = document.createElement("div");
  row.className = "ticket-row";

  // Mark as unread if admin replied and user hasn't seen it
  if (ticket.unreadForUser) {
    row.classList.add("ticket-unread");
  }

  // Last message preview
  const msgs = ticket.messages || [];
  const last = msgs[msgs.length - 1];
  let preview = "No messages";
  if (last) {
    if (last.text) preview = last.text;
    else if (last.img) preview = "📷 Photo";
  }
  const previewShort = preview.length > 60 ? preview.slice(0, 60) + "…" : preview;

  // Status class for CSS
  const statusClass = "ticket-status-" + (ticket.status || "open");
  const statusLabel = ticket.status === "resolved"
    ? "Resolved"
    : ticket.status === "awaiting_user"
      ? "Awaiting you"
      : "Open";

  row.innerHTML =
    '<div class="ticket-row-top">' +
      '<span class="ticket-row-cat">' + escapeHtml(ticket.categoryLabel || "🎫 Ticket") + '</span>' +
      '<span class="ticket-row-status ' + statusClass + '">' + statusLabel + '</span>' +
    '</div>' +
    '<div class="ticket-row-subject">' + escapeHtml(ticket.subject || "(no subject)") + '</div>' +
    '<div class="ticket-row-preview">' + escapeHtml(previewShort) + '</div>' +
    '<div class="ticket-row-time">' + escapeHtml(ticket.createdAtStr || "") + '</div>';

  // Tapping opens the ticket detail
row.addEventListener("click", function () {
  openTicketDetail(ticket._docId);
});

  return row;
}

// Updates the badge on the "My tickets" button in the Support modal.
// Shows the count of tickets with admin replies the user hasn't seen yet.
function updateMyTicketsBadge() {
  const badge = document.getElementById("myTicketsBadge");
  if (!badge) return;

  const unread = _myTicketsCache.filter(function (t) {
  return t.unreadForUser === true && t.status !== "resolved";
}).length;
  if (unread > 0) {
    badge.textContent = String(unread);
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }
}

// Refresh the badge when the Support modal opens
// (so it's accurate even before the user visits the page)
async function refreshMyTicketsBadgeQuietly() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) return;

  try {
    const { db, collection, query, where, getDocs } = await getFsModules();
    const q = query(collection(db, "tickets"), where("userId", "==", user.uid));
    const snap = await getDocs(q);
    let unread = 0;
    snap.forEach(function (d) {
      const t = d.data();
      if (t.unreadForUser === true && t.status !== "resolved") unread++;
    });
    const badge = document.getElementById("myTicketsBadge");
    if (badge) {
      if (unread > 0) {
        badge.textContent = String(unread);
        badge.style.display = "";
      } else {
        badge.style.display = "none";
      }
    }
  } catch (err) {
    // Silent fail
  }
}

// ============================================
// TICKET DETAIL — open, close, render, reply
// ============================================
let _currentTicketId = null;
let _currentTicketData = null;
let _ticketAdminMode = false;      // true when viewing from the moderation panel

// Opens the ticket detail page for the given ticket doc id.
// Pass opts.admin = true to open in admin mode.
async function openTicketDetail(ticketDocId, opts) {
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) {
    openAuthFromHeader();
    return;
  }

  if (!ticketDocId) return;

  // Detect admin mode
  _ticketAdminMode = !!(opts && opts.admin);

  // Find the ticket in our cache
  const ticket = _myTicketsCache.find(function (t) { return t._docId === ticketDocId; });
  if (!ticket) {
    marketaToast("Ticket not found");
    return;
  }

  _currentTicketId = ticketDocId;
  _currentTicketData = ticket;

// --- Clear the appropriate "unread" flag ---
// Update BOTH caches immediately (in case the ticket exists in both)
// so the badge clears on the next render, regardless of Firestore timing.
try {
  const { db, doc, updateDoc } = await getFsModules();

  if (_ticketAdminMode && ticket.unreadForAdmin === true) {
    ticket.unreadForAdmin = false;

    // Also clear it in the admin cache copy
    const adminCopy = (_modTicketsCache || []).find(function (t) {
      return t._docId === ticketDocId;
    });
    if (adminCopy) adminCopy.unreadForAdmin = false;

    await updateDoc(doc(db, "tickets", ticketDocId), { unreadForAdmin: false });

    // Re-render the admin list in the background (it's hidden but
    // this keeps the DOM clean for when it reappears)
    if (typeof renderModerationTab === "function" && _moderationTab === "tickets") {
      renderModerationTab();
    }

  } else if (!_ticketAdminMode && ticket.unreadForUser === true) {
    ticket.unreadForUser = false;

    // Also clear it in the user cache copy
    const userCopy = (_myTicketsCache || []).find(function (t) {
      return t._docId === ticketDocId;
    });
    if (userCopy) userCopy.unreadForUser = false;

    await updateDoc(doc(db, "tickets", ticketDocId), { unreadForUser: false });

    if (typeof refreshMyTicketsBadgeQuietly === "function") {
      refreshMyTicketsBadgeQuietly();
    }
  }
} catch (err) {
  console.warn("Could not clear unread flag:", err);
}

  // Save this page as the last location so a refresh can restore it
  saveLastLocation("ticketDetailPage", {
    ticketId: ticketDocId,
    admin: _ticketAdminMode
  });

  // Populate the header
  const catEl = document.getElementById("ticketDetailCat");
  const statusEl = document.getElementById("ticketDetailStatus");
  const subjectEl = document.getElementById("ticketDetailSubject");
  const metaEl = document.getElementById("ticketDetailMeta");

  if (catEl) catEl.textContent = ticket.categoryLabel || "🎫 Ticket";
  if (subjectEl) subjectEl.textContent = ticket.subject || "(no subject)";

  const statusLabel = ticket.status === "resolved"
    ? "Resolved"
    : ticket.status === "awaiting_user"
      ? "Awaiting user"
      : "Open";
  if (statusEl) {
    statusEl.textContent = statusLabel;
    statusEl.className = "ticket-row-status ticket-status-" + (ticket.status || "open");
  }

  if (metaEl) {
    if (_ticketAdminMode) {
      metaEl.textContent = "From " + (ticket.userName || "user") +
        (ticket.userEmail ? " (" + ticket.userEmail + ")" : "") +
        " · opened " + (ticket.createdAtStr || "");
    } else {
      metaEl.textContent = "Opened " + (ticket.createdAtStr || "");
    }
  }

  // Render the messages
  renderTicketMessages(ticket);

  // Show/hide the resolve button and reply bar based on status
  const resolveBtn = document.getElementById("ticketResolveBtn");
  const replyBar = document.getElementById("ticketDetailReplyBar");
  const closedNotice = document.getElementById("ticketDetailClosed");
  const isResolved = ticket.status === "resolved";

  // Both user and admin can resolve
  if (resolveBtn) resolveBtn.style.display = isResolved ? "none" : "block";

  // Admin can still reply to resolved tickets (reopens them);
  // user can't reply once resolved
  if (replyBar) {
    if (isResolved && !_ticketAdminMode) {
      replyBar.style.display = "none";
    } else {
      replyBar.style.display = "flex";
    }
  }

  // Closed notice shows to the user only
  if (closedNotice) {
    closedNotice.style.display = (isResolved && !_ticketAdminMode) ? "block" : "none";
  }

  // Update the resolve button label for admin vs user
  if (resolveBtn) {
    if (_ticketAdminMode && isResolved) {
      resolveBtn.textContent = "🔄 Reopen ticket";
      resolveBtn.setAttribute("onclick", "reopenTicket()");
      resolveBtn.style.display = "block";
    } else if (_ticketAdminMode) {
      resolveBtn.textContent = "✅ Mark as resolved";
      resolveBtn.setAttribute("onclick", "markTicketResolved()");
    } else {
      resolveBtn.textContent = "✅ Mark as resolved";
      resolveBtn.setAttribute("onclick", "markTicketResolved()");
    }
  }

  // Clear the reply input
  const input = document.getElementById("ticketReplyInput");
  if (input) {
    input.value = "";
    if (_ticketAdminMode) {
      input.placeholder = "Reply as support...";
    } else {
      input.placeholder = "Write a reply...";
    }
  }

  // Hide the My Tickets page and the moderation panel visually,
  // but keep them in the layer stack.
  const ticketsPage = document.getElementById("myTicketsPage");
  if (ticketsPage) ticketsPage.style.display = "none";
  const modPage = document.getElementById("moderationPage");
  if (modPage) modPage.style.display = "none";

  // Show the detail page
  const page = document.getElementById("ticketDetailPage");
  if (page) page.style.display = "flex";
  document.body.classList.add("page-open");
  document.body.classList.add("ticket-detail-open");

  pushLayer("ticketDetailPage", closeTicketDetail);

  // Scroll to bottom of the messages
  setTimeout(function () {
    const box = document.getElementById("ticketDetailMessages");
    if (box) box.scrollTop = box.scrollHeight;
  }, 50);
}

// Closes the ticket detail page.
function closeTicketDetail() {
  const page = document.getElementById("ticketDetailPage");
  if (page) page.style.display = "none";
  document.body.classList.remove("ticket-detail-open");

  popLayer("ticketDetailPage");

  // Which page was underneath? Bring it back — and RE-RENDER it
  // so the status + preview reflect any changes made while we
  // were on the detail page.
  if (_layerStack.some(function (l) { return l.id === "myTicketsPage"; })) {
    const ticketsPage = document.getElementById("myTicketsPage");
    if (ticketsPage) ticketsPage.style.display = "flex";
    // Refresh the list
    if (typeof renderMyTickets === "function") {
      renderMyTickets();
    }
    return;
  }

  if (_layerStack.some(function (l) { return l.id === "moderationPage"; })) {
    const modPage = document.getElementById("moderationPage");
    if (modPage) modPage.style.display = "flex";
    // Refresh the moderation Tickets tab if that's what we were on
    if (_moderationTab === "tickets" && typeof renderModerationTab === "function") {
      renderModerationTab();
    }
    return;
  }

  if (!hasAnotherPageOpen("ticketDetailPage")) {
    document.body.classList.remove("page-open");
  }
}

// Renders the conversation thread.
function renderTicketMessages(ticket) {
  const box = document.getElementById("ticketDetailMessages");
  if (!box) return;
  box.innerHTML = "";

  const msgs = ticket.messages || [];
  if (msgs.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "text-align:center;color:var(--text-muted);font-size:13px;padding:20px;";
    empty.textContent = "No messages yet.";
    box.appendChild(empty);
    return;
  }

  msgs.forEach(function (m) {
    const bubble = document.createElement("div");
    bubble.className = "ticket-msg " + (m.from === "admin" ? "admin" : "user");

    let inner = '<div class="ticket-msg-text">' + escapeHtml(m.text || "") + '</div>';
    if (m.img) {
      inner += '<img class="ticket-msg-img" src="' + m.img + '" alt="">';
    }
    inner += '<span class="ticket-msg-meta">' + escapeHtml(m.time || "") + '</span>';

    bubble.innerHTML = inner;
    box.appendChild(bubble);
  });
}

// Sends a reply to the current ticket.
// Uses "admin" or "user" as the sender, based on _ticketAdminMode.
async function sendTicketReply() {
  if (!_currentTicketId) return;

  const input = document.getElementById("ticketReplyInput");
  if (!input) return;

  const text = (input.value || "").trim();
  if (!text) {
    marketaToast("Type a reply first");
    return;
  }

  const ticket = _myTicketsCache.find(function (t) { return t._docId === _currentTicketId; });
  if (!ticket) {
    marketaToast("Ticket not found");
    return;
  }

  // Append the reply
  const now = Date.now();
  const nowStr = new Date().toLocaleString();
  const fromRole = _ticketAdminMode ? "admin" : "user";

  if (!ticket.messages) ticket.messages = [];
  ticket.messages.push({
    from: fromRole,
    text: text,
    img: null,
    time: nowStr,
    sentAt: now
  });

  // Set unread flags:
  //   admin replies  → unread for the user
  //   user replies   → unread for the admin
  if (_ticketAdminMode) {
    ticket.unreadForUser = true;
    ticket.unreadForAdmin = false;
    // Admin reply = "awaiting user"
    ticket.status = "awaiting_user";
  } else {
    ticket.unreadForAdmin = true;
ticket.unreadForUser = false;
// User reply reopens the ticket if it was resolved OR awaiting them
if (ticket.status === "resolved" || ticket.status === "awaiting_user") {
  ticket.status = "open";
}
  }

  ticket.updatedAt = now;

  // Clear the input immediately (feels snappy)
  input.value = "";
  input.style.height = "";

  // Render the new message
  renderTicketMessages(ticket);

  // Update the status badge if it changed
  const statusEl = document.getElementById("ticketDetailStatus");
  if (statusEl) {
    const statusLabel = ticket.status === "resolved"
      ? "Resolved"
      : ticket.status === "awaiting_user"
        ? "Awaiting user"
        : "Open";
    statusEl.textContent = statusLabel;
    statusEl.className = "ticket-row-status ticket-status-" + ticket.status;
  }

  // Scroll to bottom
  const box = document.getElementById("ticketDetailMessages");
  if (box) {
    setTimeout(function () { box.scrollTop = box.scrollHeight; }, 50);
  }

  // Save to Firestore
  try {
    const { db, doc, setDoc } = await getFsModules();
    await setDoc(doc(db, "tickets", _currentTicketId), ticket);
  } catch (err) {
    console.warn("Failed to save reply:", err);
    marketaAlert("❌ Error", "Couldn't save your reply: " + err.message);
  }
}

// Marks the current ticket as resolved.
async function markTicketResolved() {
  if (!_currentTicketId) return;

  const ticket = _myTicketsCache.find(function (t) { return t._docId === _currentTicketId; });
  if (!ticket) return;

  marketaConfirm(
    "✅ Mark as resolved?",
    "This closes the ticket. You can reopen it later by replying again.",
    async function () {
      ticket.status = "resolved";
      ticket.updatedAt = Date.now();

      try {
        const { db, doc, setDoc } = await getFsModules();
        await setDoc(doc(db, "tickets", _currentTicketId), ticket);

        // Update the page state
        const statusEl = document.getElementById("ticketDetailStatus");
        if (statusEl) {
          statusEl.textContent = "Resolved";
          statusEl.className = "ticket-row-status ticket-status-resolved";
        }
        const resolveBtn = document.getElementById("ticketResolveBtn");
        const replyBar = document.getElementById("ticketDetailReplyBar");
        const closedNotice = document.getElementById("ticketDetailClosed");
        if (resolveBtn) resolveBtn.style.display = "none";
        if (replyBar) replyBar.style.display = "none";
        if (closedNotice) closedNotice.style.display = "block";

        marketaToast("Ticket resolved ✅");
      } catch (err) {
        marketaAlert("❌ Error", "Couldn't resolve ticket: " + err.message);
      }
    },
    null
  );
}

// Admin-only: reopens a resolved ticket.
async function reopenTicket() {
  if (!_currentTicketId) return;

  const ticket = _myTicketsCache.find(function (t) { return t._docId === _currentTicketId; });
  if (!ticket) return;

  marketaConfirm(
    "🔄 Reopen this ticket?",
    "The user will be able to reply again.",
    async function () {
      ticket.status = "open";
      ticket.updatedAt = Date.now();

      try {
        const { db, doc, setDoc } = await getFsModules();
        await setDoc(doc(db, "tickets", _currentTicketId), ticket);

        // Update the page state
        const statusEl = document.getElementById("ticketDetailStatus");
        if (statusEl) {
          statusEl.textContent = "Open";
          statusEl.className = "ticket-row-status ticket-status-open";
        }
        const resolveBtn = document.getElementById("ticketResolveBtn");
        const replyBar = document.getElementById("ticketDetailReplyBar");
        if (resolveBtn) {
          resolveBtn.textContent = "✅ Mark as resolved";
          resolveBtn.setAttribute("onclick", "markTicketResolved()");
          resolveBtn.style.display = "block";
        }
        if (replyBar) replyBar.style.display = "flex";

        marketaToast("Ticket reopened 🔄");
      } catch (err) {
        marketaAlert("❌ Error", "Couldn't reopen ticket: " + err.message);
      }
    },
    null
  );
}


// Auto-grow the reply textarea as the user types
function attachTicketReplyAutoGrow() {
  const input = document.getElementById("ticketReplyInput");
  if (!input) return;
  if (input.dataset.growWired === "yes") return;
  input.dataset.growWired = "yes";

  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
}
attachTicketReplyAutoGrow();
window.addEventListener("load", attachTicketReplyAutoGrow);


// Placeholder — photo preview comes in Step 2.
function previewTicketPhoto() {
  const fileEl = document.getElementById("ticketImage");
  const previewEl = document.getElementById("ticketPhotoPreview");
  if (!fileEl || !previewEl) return;

  const file = fileEl.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    marketaAlert("Photo too large", "Please choose a photo under 5MB. 🙏");
    fileEl.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 800 / img.width, 800 / img.height);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressed = canvas.toDataURL("image/jpeg", 0.7);
      _ticketImageData = compressed;
      previewEl.innerHTML = '<img src="' + compressed + '" alt="">';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ============================================
// SUPPORT
// ============================================
function openSupport() {
  document.getElementById("supportModal").classList.add("show");

  // Tell the layer manager we're open
  pushLayer("supportModal", closeSupport);
}
function closeSupport() {
  document.getElementById("supportModal").classList.remove("show");

  // Tell the layer manager we're closed
  popLayer("supportModal");
  
  // Refresh the "My tickets" badge with the latest count
if (typeof refreshMyTicketsBadgeQuietly === "function") {
  refreshMyTicketsBadgeQuietly();
}
}

// ============================================
// SELL FORM
// ============================================
function toggleSellPage() {
  const modal = document.getElementById("sellModal");
  const wasOpen = modal.classList.contains("show");
  modal.classList.toggle("show");

  if (wasOpen) {
    resetSellForm();
    // Reset the bottom nav highlight to Home
    document.querySelectorAll(".bottom-nav-item").forEach(function(el) {
      el.classList.toggle("active", el.getAttribute("data-tab") === "home");
    });
    // Tell the layer manager we're closed
    popLayer("sellModal");
  } else {
    // Always start at Step 1 when opening
    currentSellStep = 1;
    renderSellStep();
    // Highlight the "Sell" tab in the bottom nav
    document.querySelectorAll(".bottom-nav-item").forEach(function(el) {
      el.classList.toggle("active", el.getAttribute("data-tab") === "sell");
    });
    // Tell the layer manager we're open
    pushLayer("sellModal", toggleSellPage);
  }
}

function resetSellForm() {
  editingListingIndex = null;
  _sellPublishMode = false;
  currentPhotos = [];
  currentSellStep = 1;

  document.getElementById("itemName").value = "";
  document.getElementById("itemPrice").value = "";
  document.getElementById("itemQuantity").value = "1";
  document.getElementById("itemLocation").value = "";
  document.getElementById("itemDescription").value = "";
  document.getElementById("itemNegotiable").checked = false;
  document.getElementById("itemCategory").value = "";
  updateSubCategoryDropdown();
  document.getElementById("itemCondition").value = "";
  const regionEl = document.getElementById("itemRegion");
  if (regionEl) regionEl.value = "";

  document.getElementById("photoPreview").innerHTML = "📷";
  const counter = document.getElementById("photoCount");
  if (counter) counter.textContent = "";

  clearDetailRows();
  updateSellCounters();
  renderSellStep();
}

function previewPhoto() {
  if (currentPhotos.length >= 3) {
  marketaAlert("Photo limit", "You can add up to 3 photos. Remove one first. 🙏");
  return;
}
  const file = document.getElementById("itemPhoto").files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
  marketaAlert("Photo too large", "Please choose a photo under 8MB. 🙏");
  return;
}
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 400 / img.width, 400 / img.height);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressed = canvas.toDataURL("image/jpeg", 0.7);
      currentPhotos.push(compressed);
      renderPhotoStrip();
      document.getElementById("itemPhoto").value = "";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function renderPhotoStrip() {
  const preview = document.getElementById("photoPreview");
  const counter = document.getElementById("photoCount");
  if (currentPhotos.length === 0) {
    preview.innerHTML = "📷";
    if (counter) counter.textContent = "";
    return;
  }
  let html = '<div class="photo-strip">';
  currentPhotos.forEach(function(p, i) {
    html += '<div class="photo-thumb">' +
      '<img src="' + p + '" alt="">' +
      '<button class="photo-remove" onclick="removePhoto(' + i + ')">✕</button>' +
      '</div>';
  });
  if (currentPhotos.length < 3) {
    html += '<div class="photo-add-more">Add</div>';
  }
  html += '</div>';
  preview.innerHTML = html;
  if (counter) counter.textContent = "· " + currentPhotos.length + " of 3";
}

function removePhoto(index) {
  currentPhotos.splice(index, 1);
  renderPhotoStrip();
}

// ============================================
// LISTINGS — RENDERING
// ============================================
// Returns listings that should be visible to the public.
// Hidden listings (removed by admin) are excluded.
// Sold listings are also excluded from the public browse.
function getVisibleListings() {
  return allListingsCache.filter(function (item) {
    return !item.hidden;
  });
}

// Returns a user's own listings INCLUDING hidden ones,
// so they can see what was removed from their shop.
function getMyListingsIncludingHidden() {
  return allListingsCache.filter(function (item) {
    return item.sellerId === currentUserId;
  });
}

function toggleFilters() {
  document.getElementById("filterPanel").classList.toggle("show");
}

function loadListings() {
  document.getElementById("filterBanner").style.display = "none";
  const listingsDiv = document.querySelector(".listings");
  listingsDiv.innerHTML = "";

  const loading = document.createElement("p");
  loading.id = "listingsLoading";
  loading.style.cssText = "grid-column: 1 / -1;text-align:center;color:#999;padding:20px;";
  loading.textContent = "Loading listings…";
  listingsDiv.appendChild(loading);

  loadListingsFromFirestore()
    .then(function(items) {
      renderListings(items);
    })
    .catch(function(err) {
      console.warn("Firestore read failed:", err);
      const local = JSON.parse(localStorage.getItem("marketaListings")) || [];
      allListingsCache = local;
      renderListings(local);
    });
}

// Counts active (unsold) listings per category and writes the count
// into each category card on the homepage.
function updateCategoryCounts() {
  // Build a lookup: category → count
// (excluding blocked sellers so the numbers match the grid)
const counts = {};
allListingsCache.forEach(function (item) {
  if (item.sold) return;               // don't count sold listings
  if (item.sellerId && _blockedUsersCache.indexOf(item.sellerId) !== -1) return;
  const cat = item.category || "";
  if (!cat) return;
  counts[cat] = (counts[cat] || 0) + 1;
});

  // Update category cards on the homepage AND in the All Categories modal.
  // Homepage tiles use filterCategory('...'), modal tiles use pickCategory('...').
  const catCards = document.querySelectorAll(".categories .card[onclick]");
  catCards.forEach(function (card) {
    const onclickAttr = card.getAttribute("onclick") || "";
    const match = onclickAttr.match(/(?:filterCategory|pickCategory)\('([^']+)'\)/);
    if (!match) return;

    const category = match[1];
    const count = counts[category] || 0;

// Find or create the count subtitle inside this card
let badge = card.querySelector(".cat-count");
if (!badge) {
  badge = document.createElement("span");
  badge.className = "cat-count";
  // Insert it right AFTER the label (so it appears as a subtitle)
  const label = card.querySelector(".cat-label");
  if (label && label.parentNode === card) {
    label.insertAdjacentElement("afterend", badge);
  } else {
    card.appendChild(badge);
  }
}

// Show only if count > 0 — cleaner when a category is empty
if (count > 0) {
  badge.textContent = count + (count === 1 ? " ad" : " ads");
  badge.style.display = "block";
} else {
  badge.style.display = "none";
}
  });
}

    function renderListings(items) {
  // Hold the first render until we know the user's block list.
  // Meanwhile, show skeleton placeholders so the user sees a
  // proper loading state instead of a blank grid.
  if (!_blockedUsersLoaded) {
    // Show skeletons — but only once. Don't overwrite them
    // if we've already drawn them.
    const grid = document.querySelector(".listings");
    if (grid && !grid.querySelector(".skeleton-card")) {
      showStartupLoading();
    }

    // Safety net: after 3 seconds, render anyway so the homepage
    // never stays on skeletons forever.
    if (!window._renderTimeoutStarted) {
      window._renderTimeoutStarted = true;
      setTimeout(function () {
        if (!_blockedUsersLoaded) {
          _blockedUsersLoaded = true;  // unblock subsequent renders
          renderListings(allListingsCache);
        }
      }, 3000);
    }
    return;
  }

  window._renderTimeoutStarted = false;
    updateCategoryCounts();
  const listingsDiv = document.querySelector(".listings");
  listingsDiv.innerHTML = "";

  // Render the "Continue browsing" row (uses the cache)
  if (typeof renderRecentlyViewed === "function") {
    renderRecentlyViewed();
  }

  // Filter out hidden listings
items = (items || []).filter(function (item) {
  return !item.hidden;
});

// Filter out listings from sellers I've blocked
items = filterOutBlockedSellers(items);

if (!items || items.length === 0) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.style.cssText = "grid-column: 1 / -1;";
  empty.innerHTML =
    '<div class="empty-state-icon">🛍️</div>' +
    '<div class="empty-state-title">No listings yet</div>' +
    '<div class="empty-state-text">Be the first to post something on Marketa.</div>' +
    '<button class="shop-empty-btn" onclick="requireLogin(\'post a listing\', toggleSellPage);">Post a new ad</button>';
  listingsDiv.appendChild(empty);
  return;
}

  // Homepage shows only the newest 20 listings.
  // The Browse page ("View All") still shows everything.
  const MAX_HOME = 20;
  const shown = items.slice(0, MAX_HOME);

  shown.forEach(function(item) {
    // Find the real index in the full cache so detail modal works
    const realIndex = allListingsCache.findIndex(function(l) {
      return l.id === item.id;
    });
    listingsDiv.appendChild(createCard(item, realIndex >= 0 ? realIndex : 0));
  });
}

function createCard(item, index) {
  const card = document.createElement("div");
  card.className = "listing";
// Attach filterable fields as data-attributes so filters can find them
card.dataset.condition = (item.condition || "").toLowerCase();
card.dataset.name = (item.name || "").toLowerCase();
card.dataset.location = (item.location || "").toLowerCase();
card.dataset.category = (item.category || "").toLowerCase();

  const isMine = item.sellerId === currentUserId || item.sellerId === (currentAuthUser && currentAuthUser.uid);
  const dispute = getDisputeForListing(item.id);
  const isDisputed = !!dispute;

  if (isDisputed) {
    card.style.opacity = "0.95";
  } else if (item.sold) {
    card.style.opacity = "0.6";
  } else {
    card.onclick = function() { showDetail(index); };
  }

  const photoList = (item.photos && item.photos.length > 0) ? item.photos : (item.photo ? [item.photo] : []);
  const thumbSrc = photoList[0] || null;
  const timeText = (item.postedAt || Number(item.id)) ? timeAgo(item.postedAt || Number(item.id)) : "";
  const soldBadge = item.sold ? ' <span class="sold-badge">SOLD</span>' : '';

  let actionBtn = "";
  if (isDisputed) {
    actionBtn = '<button class="card-action-btn card-action-dispute" disabled>⚠ Under Review</button>';
  } else if (item.sold) {
    actionBtn = '<button class="card-action-btn card-action-sold" disabled>Sold</button>';
  } else if (isMine) {
    actionBtn = '<button class="card-action-btn card-action-mine">View My Listing</button>';
  } else {
    actionBtn = '<button class="card-buy-btn" data-idx="' + index + '">Buy with Escrow</button>';
  }

  card.innerHTML =
  '<div class="card-thumb">' +
    (thumbSrc ? '<img src="' + thumbSrc + '" alt="">' : '<div class="thumb-placeholder">📦</div>') +
    (isDisputed ? '<div class="badge-dispute">⚠ DISPUTE ACTIVE</div>' : '<span class="badge-escrow">🛡 ESCROW ✓</span>') +
  '</div>' +
  '<div class="card-body">' +
    '<h3>' + escapeHtml(formatTitle(item.name)) + '</h3>' +
    '<p class="card-meta">' +
  '<span class="card-meta-loc">' +
    '<svg class="card-meta-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>' +
      '<circle cx="12" cy="10" r="3"></circle>' +
    '</svg>' +
    escapeHtml(item.location) +
  '</span>' +
  (timeText ? '<span class="card-meta-time">' + escapeHtml(timeText) + '</span>' : '') +
'</p>' +
    '<div class="card-price-row">' +
  '<span class="price">GH₵ ' + Number(item.price).toLocaleString() + '</span>' +
  (item.isPromoted && (!item.promotedExpiresAt || item.promotedExpiresAt > Date.now()) ? '<span class="promoted-badge">🔥 PROMOTED</span>' : '') +
  soldBadge +
'</div>' +
    actionBtn +
  '</div>';

  const buyBtn = card.querySelector(".card-buy-btn");
  if (buyBtn) {
    buyBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      currentItemIndex = index;
      openCheckout();
    });
  }

  const mineBtn = card.querySelector(".card-action-mine");
  if (mineBtn) {
    mineBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      showDetail(index);
    });
  }

  return card;
}

function showDetail(index) {
  const item = allListingsCache[index];
  if (!item) return;

  // Save this listing as the last location so a refresh
  // can restore it. We store the firestore id (not the
  // index) because indices shift as listings change.
  saveLastLocation("detailModal", { itemId: item.id });

  // Resolve the current user id — prefer the auth user if available
  const myUid = (currentAuthUser && currentAuthUser.uid)
    || currentUserId
    || null;

  // Determine context BEFORE any blocking rules
const isOwner = myUid && item.sellerId === myUid;
const isAdminView = _layerStack.some(function(l) { return l.id === "moderationPage"; });
const isFromMyListings = _layerStack.some(function(l) { return l.id === "listingsModal"; });
const isHidden = !!item.hidden;

  // Sold listings can only be opened by their owner or admin
  if (item.sold && !isOwner && !isAdminView && !isFromMyListings) {
    marketaToast("This listing has been sold");
    return;
  }

  // Hidden listings can only be opened by their owner or admin
  if (item.hidden && !isOwner && !isAdminView && !isFromMyListings) {
    marketaToast("This listing is no longer available");
    return;
  }

  currentItemIndex = index;

  // ============ Photos ============
  const photoList = (item.photos && item.photos.length > 0) ? item.photos : (item.photo ? [item.photo] : []);
  currentPhotoIndex = 0;
  const arrowLeft = document.getElementById("carouselLeft");
  const arrowRight = document.getElementById("carouselRight");
  const counter = document.getElementById("carouselCounter");

  if (photoList.length === 0) {
    document.getElementById("detailPhoto").innerHTML = "📦";
    arrowLeft.classList.remove("show");
    arrowRight.classList.remove("show");
    counter.classList.remove("show");
  } else if (photoList.length === 1) {
    document.getElementById("detailPhoto").innerHTML = '<img src="' + photoList[0] + '" alt="">';
    arrowLeft.classList.remove("show");
    arrowRight.classList.remove("show");
    counter.classList.remove("show");
  } else {
    document.getElementById("detailPhoto").innerHTML = '<img src="' + photoList[0] + '" alt="">';
    arrowLeft.classList.add("show");
    arrowRight.classList.add("show");
    counter.classList.add("show");
    counter.textContent = "1 / " + photoList.length;
  }

// ============ Breadcrumb ============
const bcCat = document.getElementById("detailBreadcrumbCat");
const bcTitle = document.getElementById("detailBreadcrumbTitle");
if (bcCat) bcCat.textContent = item.category || "Category";
if (bcTitle) bcTitle.textContent = formatTitle(item.name) || "—";

// ============ Thumbnail strip ============
renderDetailThumbs(photoList);

  // ============ Removed banner ============
  const removedBanner = document.getElementById("detailRemovedBanner");
  if (removedBanner) {
    removedBanner.style.display = item.hidden ? "block" : "none";
  }

  // ============ Title ============
document.getElementById("detailName").textContent = formatTitle(item.name);

// Hide the subtitle — condition is shown in DETAILS below
document.getElementById("detailSubtitle").textContent = "";
document.getElementById("detailSubtitle").style.display = "none";

// ============ Meta row ============
const locLine = document.getElementById("detailLocationLine");
const factsLine = document.getElementById("detailFactsLine");

// ---- Line 1: Location (area + region) ----
if (locLine) {
  const area = item.location || "";
  const region = item.region || "";
  const locText = area && region
    ? area + ", " + region
    : (area || region || "—");
  locLine.innerHTML =
  '<span class="detail-meta-icon">' + locationIcon() + '</span>' +
  '<span class="detail-meta-text">' + escapeHtml(locText) + '</span>';
}

// ---- Line 2: Time · Reviews · Views · Sold ----
if (factsLine) {
  factsLine.innerHTML = "";

  // Time
  const tRaw = item.postedAt || Number(item.id);
  const timeText = tRaw ? timeAgo(tRaw) : "";
  if (timeText) {
    factsLine.appendChild(buildMetaPiece("🕐", timeText));
  }

  // Reviews / rating
  factsLine.appendChild(buildMetaPiece("⭐", "No Reviews"));

  // Views — show the real count
  const viewsCount = Number(item.views) || 0;
  const viewsPiece = buildMetaPiece("👁", viewsCount + " view" + (viewsCount === 1 ? "" : "s"));
  // Give the piece an id so we can live-update it
  const viewsText = viewsPiece.querySelector(".detail-meta-text");
  if (viewsText) viewsText.id = "detailViewsCount";
  factsLine.appendChild(viewsPiece);

  // Sold — only show if > 0
  const soldCount = allOrdersCache.filter(function (o) {
    return o.itemId === item.id && o.status === "Funds released to seller";
  }).length;
  if (soldCount > 0) {
    factsLine.appendChild(buildMetaPiece("🛒", soldCount + " Sold"));
  }
}

// Bump the views counter — but only for OTHER people's listings
const isMyOwnListing = item.sellerId === currentUserId ||
                       item.sellerId === (currentAuthUser && currentAuthUser.uid);
if (!isMyOwnListing) {
  incrementListingViews(item.id).catch(function (e) { console.warn(e); });

  // Remember this in "Recently viewed" for the homepage
  recordListingView(item.id);
}

  /// ============ Price ============
document.getElementById("detailPrice").textContent = "GH₵ " + Number(item.price).toLocaleString();
const negEl = document.getElementById("detailNegotiable");
if (negEl) {
  if (item.negotiable) {
    negEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1.5px;margin-right:4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>Price Negotiable';
  } else {
    negEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1.5px;margin-right:4px;"><rect x="3" y="6" width="18" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.5"></circle></svg>Fixed Price';
  }
}

// ============ Quantity selector ============
setupDetailQty(item);

  // ============ Product details ============
document.getElementById("detailCategory").textContent = item.category || "—";
document.getElementById("detailCondition").textContent = item.condition || "—";

// Sub-category display logic
const subCatRow = document.getElementById("detailSubCategoryRow");
const subCatEl = document.getElementById("detailSubCategory");
if (subCatRow && subCatEl) {
  if (item.subCategory && item.subCategory.trim() !== "") {
    subCatEl.textContent = item.subCategory;
    subCatRow.style.display = "flex";
  } else {
    subCatRow.style.display = "none";
  }
}
  // ============ Custom details (Session B) ============
renderCustomDetails(item.details || []);

  // ============ Description ============
  document.getElementById("detailDescription").textContent = item.description || "No description provided.";

  // ============ Related products & Safety Tips ============
  if (isOwner) {
    // Hide "Similar ads" for the owner
    const relSection = document.getElementById("detailRelatedSection");
    if (relSection) relSection.style.display = "none";
    
    // Hide "Safety Tips" for the owner
    const safetyCard = document.querySelector(".detail-safety-card");
    if (safetyCard) safetyCard.style.display = "none";
  } else {
    // Show them normally for buyers
    renderRelatedProducts(item);
    const safetyCard = document.querySelector(".detail-safety-card");
    if (safetyCard) safetyCard.style.display = "block";
  }

// ============ Seller block ============
renderSellerBlock(item).catch(function(e) { console.warn(e); });
  // ============ Follow seller ============
if (!_followsLoaded) {
  loadFollowsFromFirestore().then(function() {
    updateFollowButton(item.sellerId);
  });
} else {
  updateFollowButton(item.sellerId);
}
loadFollowerCountForSeller(item.sellerId);

// ============ Hide buy/chat bar in certain contexts ============
const stickyBar = document.querySelector(".detail-sticky-bar");

const boostBtn = document.getElementById("detailBoostBtn");

if (isOwner || isAdminView || isHidden) {
  // Show the bar, but hide chat and buy
  if (stickyBar) stickyBar.style.display = "flex";
  const chatBtn = document.querySelector(".detail-sticky-chat");
  const buyBtn = document.getElementById("detailBuyBtn");
  if (chatBtn) chatBtn.style.display = "none";
  if (buyBtn) buyBtn.style.display = "none";
  
  // Show Boost (only if it's NOT hidden and NOT sold)
  if (boostBtn) {
    if (item.hidden || item.sold) {
      boostBtn.style.display = "none";
    } else {
      boostBtn.style.display = "block";
    }
  }
} else {
  // Normal buyer view
  if (stickyBar) stickyBar.style.display = "flex";
  const chatBtn = document.querySelector(".detail-sticky-chat");
  const buyBtn = document.getElementById("detailBuyBtn");
  if (chatBtn) chatBtn.style.display = "block";
  if (buyBtn) buyBtn.style.display = "block";
  
  if (boostBtn) boostBtn.style.display = "none";
}

// ============ Wishlist ============
if (!_wishlistLoaded) {
  loadWishlistFromFirestore().then(function() {
    updateWishlistButton(item.id);
  });
} else {
  updateWishlistButton(item.id);
}

  // ============ Load seller rating ============
  loadSellerRatingForListing(item.sellerId);

  // ============ Show the modal ============
  document.getElementById("detailModal").classList.add("show");

  // Tell the layer manager we're open
  pushLayer("detailModal", closeDetail);

  // Scroll the body back to top
  const detailBody = document.querySelector(".detail-body");
  if (detailBody) detailBody.scrollTop = 0;
}

function prevPhoto() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;
  const photoList = (item.photos && item.photos.length > 0) ? item.photos : (item.photo ? [item.photo] : []);
  if (photoList.length < 2) return;
  currentPhotoIndex = (currentPhotoIndex - 1 + photoList.length) % photoList.length;
  updateCarousel(photoList);
}
function nextPhoto() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;
  const photoList = (item.photos && item.photos.length > 0) ? item.photos : (item.photo ? [item.photo] : []);
  if (photoList.length < 2) return;
  currentPhotoIndex = (currentPhotoIndex + 1) % photoList.length;
  updateCarousel(photoList);
}
function updateCarousel(photoList) {
  document.getElementById("detailPhoto").innerHTML = `<img src="${photoList[currentPhotoIndex]}" alt="">`;
  document.getElementById("carouselCounter").textContent = (currentPhotoIndex + 1) + " / " + photoList.length;
  if (typeof updateThumbActive === "function") updateThumbActive();
}

/* ============================================
   SESSION F-big — CHECKOUT PAGE
   ============================================ */

// Opens the new full-screen checkout page.
function openCheckout() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;

  const dispute = getDisputeForListing(item.id);
  if (dispute) {
    marketaAlert(
      "⚠️ Under Dispute",
      "This listing is currently under dispute and can't be purchased. Please try again later."
    );
    return;
  }

  // Save this checkout as the last location so a refresh
// can restore it (the form fields will be reset, but the
// listing and price come back).
saveLastLocation("checkoutPage", { itemId: item.id });

// Set the breadcrumb item name
const crumbItem = document.getElementById("checkoutCrumbItem");
if (crumbItem) crumbItem.textContent = formatTitle(item.name) || "Listing";

  // Reset the form
const addressEl = document.getElementById("checkoutAddress");
const noteEl = document.getElementById("checkoutNote");
if (addressEl) addressEl.value = "";
if (noteEl) noteEl.value = "";

// Pre-fill the address with the buyer's saved home location (if any)
prefillCheckoutAddress();

  // Default to "meet-up"
  setCheckoutDeliveryMode("meetup");

  // Build the order summary
  renderCheckoutSummary(item);
  
  // Attach click handlers to the delivery mode options
// (only once per page load, so guard with a data flag)
const options = document.querySelectorAll(".checkout-mode-option");
options.forEach(function (opt) {
  if (opt.dataset.handlerAttached === "yes") return;
  opt.dataset.handlerAttached = "yes";
  opt.addEventListener("click", function (e) {
    e.preventDefault();
    const mode = opt.getAttribute("data-mode");
    setCheckoutDeliveryMode(mode);
  });
});

  // Show the page
  const page = document.getElementById("checkoutPage");
  if (page) page.style.display = "flex";
  document.body.classList.add("page-open");

  // Tell the layer manager
  pushLayer("checkoutPage", closeCheckout);

  // Scroll to top
  window.scrollTo(0, 0);
}

// Closes the checkout page.
function closeCheckout() {
  const page = document.getElementById("checkoutPage");
  if (page) page.style.display = "none";

  // Tell the layer manager
  popLayer("checkoutPage");

  // Reset "page-open" if no other page is open
  if (!hasAnotherPageOpen("checkoutPage")) {
    document.body.classList.remove("page-open");
  }
}

// Switches the selected delivery mode visually.
function setCheckoutDeliveryMode(mode) {
  const options = document.querySelectorAll(".checkout-mode-option");
  options.forEach(function (el) {
    const isThis = el.getAttribute("data-mode") === mode;
    el.classList.toggle("selected", isThis);
    const check = el.querySelector(".checkout-mode-check");
    if (check) check.textContent = isThis ? "◉" : "◯";
    const radio = el.querySelector('input[type="radio"]');
    if (radio) radio.checked = isThis;
  });

// Update the address label text based on the mode
const label = document.getElementById("checkoutAddressLabel");
  if (label) {
    if (mode === "delivery") {
      label.textContent = "Delivery address";
    } else if (mode === "pickup") {
      label.textContent = "Preferred pickup area";
    } else {
      label.textContent = "Delivery address or meet-up area";
    }
  }

  // Update the address input placeholder too
  const input = document.getElementById("checkoutAddress");
  if (input) {
    if (mode === "delivery") {
      input.placeholder = "e.g. East Legon, house number";
    } else if (mode === "pickup") {
      input.placeholder = "e.g. Osu pickup station";
    } else {
      input.placeholder = "e.g. Osu, Oxford Street — near the mall";
    }
  }
}

// Fills the checkout address field from the buyer's saved location.
// Silent — if they have nothing saved, the field just stays empty.
async function prefillCheckoutAddress() {
  const addressEl = document.getElementById("checkoutAddress");
  if (!addressEl) return;

  // Already filled? Don't overwrite (e.g. reopening the page)
  if (addressEl.value && addressEl.value.trim() !== "") return;

  try {
    const fb = window.marketaFirebase;
    const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
    if (!user) return;

    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return;

    const data = snap.data();
    const area = (data.locationArea || "").trim();
    const region = (data.locationRegion || "").trim();

    let text = "";
    if (area && region) text = area + ", " + region;
    else if (area) text = area;
    else if (region) text = region;

    if (text) addressEl.value = text;
  } catch (err) {
    console.warn("prefillCheckoutAddress failed:", err);
  }
}

// Builds the order summary inside the checkout page.
function renderCheckoutSummary(item) {
  const summaryEl = document.getElementById("checkoutSummary");
  if (!summaryEl) return;

  const qty = readDetailQty();
  const unitPrice = Number(item.price) || 0;
  const subtotal = unitPrice * qty;

  const photoList = (item.photos && item.photos.length > 0)
    ? item.photos
    : (item.photo ? [item.photo] : []);
  const thumb = photoList[0] || null;

  summaryEl.innerHTML =
    '<div class="checkout-summary-item">' +
      '<div class="checkout-summary-thumb">' +
        (thumb ? '<img src="' + thumb + '" alt="">' : '📦') +
      '</div>' +
      '<div class="checkout-summary-info">' +
        '<div class="checkout-summary-title">' + escapeHtml(formatTitle(item.name)) + '</div>' +
        '<div class="checkout-summary-loc">' + locationIcon() + ' ' + escapeHtml(item.location || "—") + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="checkout-summary-row">' +
      '<span>Item price</span>' +
      '<span><strong>GH₵ ' + unitPrice.toLocaleString() + '</strong>' +
      (qty > 1 ? ' × ' + qty : '') + '</span>' +
    '</div>' +
    '<div class="checkout-summary-row">' +
      '<span>Buyer protection</span>' +
      '<span class="green">Free</span>' +
    '</div>' +
    '<div class="checkout-summary-row">' +
      '<span>Escrow fee</span>' +
      '<span>GH₵ 0</span>' +
    '</div>' +
    '<div class="checkout-summary-total">' +
      '<span>Total held in escrow</span>' +
      '<span class="amount">GH₵ ' + subtotal.toLocaleString() + '</span>' +
    '</div>';
}

// ============================================
// MY ORDERS — Buyer's dashboard
// ============================================
let _myOrdersTab = "all";

async function openOrders() {
  // Trust the subscription if it's already warmed up
  if (allOrdersCache.length === 0) {
    await loadOrdersFromFirestore();
  }

  const page = document.getElementById("ordersModal");
  if (!page) return;

  // Reset to "All" tab each time
  _myOrdersTab = "all";
  document.querySelectorAll(".orders-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === "all");
  });

  renderMyOrders();

  page.style.display = "flex";

  // Tell the layer manager we're open
  pushLayer("ordersModal", closeOrders);
}

function closeOrders() {
  const page = document.getElementById("ordersModal");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("ordersModal");
}

// Tab switching
function filterMyOrders(tab) {
  _myOrdersTab = tab;
  document.querySelectorAll(".orders-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  renderMyOrders();
}

// ============================================
// COMPUTE BUYER STATS
// ============================================
function computeMyOrderStats() {
  // Only orders where I'm the buyer
  const myOrders = allOrdersCache.filter(function (o) {
    return o.buyerId === currentUserId;
  });

  const total = myOrders.length;

  // Active = paid, shipped, returnRequested, disputed (still in flight)
  const activeStatuses = [
    "Paid — funds held in escrow",
    "Shipped — on the way",
    "returnRequested",
    "disputed"
  ];
  const active = myOrders.filter(function (o) {
    return activeStatuses.indexOf(o.status) !== -1;
  }).length;

  // Held in escrow = sum of totals still in escrow
  const escrowStatuses = [
    "Paid — funds held in escrow",
    "Shipped — on the way",
    "returnRequested",
    "disputed"
  ];
  let escrowTotal = 0;
  myOrders.forEach(function (o) {
    if (escrowStatuses.indexOf(o.status) !== -1) {
      escrowTotal += Number(o.total) || 0;
    }
  });

  return {
    total: total,
    active: active,
    escrowFunds: escrowTotal,
    orders: myOrders
  };
}

// ============================================
// RENDER MY ORDERS
// ============================================
function renderMyOrders() {
  const stats = computeMyOrderStats();

  // Stat cards
  const totalEl = document.getElementById("myOrdersTotal");
  const activeEl = document.getElementById("myOrdersActive");
  const escrowEl = document.getElementById("myOrdersEscrow");
  if (totalEl) totalEl.textContent = stats.total;
  if (activeEl) activeEl.textContent = stats.active;
  if (escrowEl) escrowEl.textContent = "GH₵ " + stats.escrowFunds.toLocaleString();

  // Sort newest first
  const orders = stats.orders.slice().sort(function (a, b) {
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  // Filter by tab
  let shown = orders;
  if (_myOrdersTab === "active") {
    shown = orders.filter(function (o) {
      return o.status === "Paid — funds held in escrow" ||
             o.status === "Shipped — on the way";
    });
  } else if (_myOrdersTab === "attention") {
    shown = orders.filter(function (o) {
      return o.status === "Shipped — on the way" ||
             o.status === "returnRequested" ||
             o.status === "disputed";
    });
  } else if (_myOrdersTab === "completed") {
    shown = orders.filter(function (o) {
      return o.status === "Funds released to seller" ||
             o.status === "refunded";
    });
  }

  // Render
  const list = document.getElementById("myOrdersList");
  const empty = document.getElementById("myOrdersEmpty");
  const emptyTitle = document.getElementById("myOrdersEmptyTitle");
  const emptyText = document.getElementById("myOrdersEmptyText");
  if (!list || !empty) return;

  list.innerHTML = "";

  if (shown.length === 0) {
    empty.style.display = "block";
    if (_myOrdersTab === "all") {
      if (emptyTitle) emptyTitle.textContent = "You have no orders yet";
      if (emptyText) emptyText.textContent = "When you buy an item with escrow protection, it will show up here so you can track it from payment to delivery.";
    } else if (_myOrdersTab === "active") {
      if (emptyTitle) emptyTitle.textContent = "No active orders";
      if (emptyText) emptyText.textContent = "Orders in progress will appear here.";
    } else if (_myOrdersTab === "attention") {
      if (emptyTitle) emptyTitle.textContent = "Nothing needs your attention";
      if (emptyText) emptyText.textContent = "When a seller ships your item, or you need to confirm delivery, it will appear here.";
    } else {
      if (emptyTitle) emptyTitle.textContent = "No completed orders";
      if (emptyText) emptyText.textContent = "Delivered and refunded orders will appear here.";
    }
    return;
  }

  empty.style.display = "none";

  shown.forEach(function (order) {
    list.appendChild(createMyOrderCard(order));
  });
}

// ============================================
// BUILD ONE ORDER CARD
// ============================================
function createMyOrderCard(order) {
  const card = document.createElement("div");
  card.className = "my-order-card";

  const countdown = getOrderCountdown(order);
  const detailId = "myorder-d-" + order.ref;

  // Build the action buttons based on status
  let action = "";
  const released = order.status === "Funds released to seller";

  if (released) {
    const alreadyRated = order.buyerRatedSeller === true;
    const rateBtn = alreadyRated
      ? '<br><span style="color:#28a745;font-size:13px;">⭐ You rated this seller</span>'
      : '<br><button class="ship-btn" style="background:#f0ad4e;" data-ref="' + order.ref + '" onclick="rateSellerFromData(this)">⭐ Rate this Seller</button>';
    action = '<span class="status-badge status-released">✅ Funds released to seller</span>' +
      rateBtn +
      '<br><button class="ship-btn" style="background:#0d6efd;margin-right:6px;margin-top:6px;" onclick="openThread(\'' + order.ref + '\', \'buyer\')">💬 View Thread</button>' +
      '<button class="ship-btn" style="background:#d9534f;margin-top:6px;" onclick="deleteOrder(\'' + order.ref + '\')">🗑 Delete</button>';
  } else if (order.status === "refunded") {
    const alreadyRated = order.buyerRatedSeller === true;
    const rateBtn = alreadyRated
      ? '<br><span style="color:#28a745;font-size:13px;">⭐ You rated this seller</span>'
      : '<br><button class="ship-btn" style="background:#f0ad4e;" data-ref="' + order.ref + '" onclick="rateSellerFromData(this)">⭐ Rate this Seller</button>';
    action = '<span class="status-badge status-held">🛡️ Refunded — seller was not paid</span>' +
      rateBtn +
      '<br><button class="ship-btn" style="background:#0d6efd;margin-right:6px;margin-top:6px;" onclick="openThread(\'' + order.ref + '\', \'buyer\')">💬 View Thread</button>' +
      '<button class="ship-btn" style="background:#d9534f;margin-top:6px;" onclick="deleteOrder(\'' + order.ref + '\')">🗑 Delete</button>';
  } else if (order.status === "returnRequested") {
    action = '<span class="status-badge status-held">⚠️ Return requested — ' + (order.returnReason || "Item doesn\'t match description") + '</span>' +
      '<br><span style="color:#b36b00;">📦 Ship the item back to the seller. Your money is still held safely in escrow.</span>' +
      '<br><button class="ship-btn" style="background:#676e22;margin-top:6px;" onclick="disputeOrder(\'' + order.ref + '\')">⚖️ Escalate to Admin</button>' +
      '<br><button class="ship-btn" style="background:#0d6efd;" onclick="openThread(\'' + order.ref + '\', \'buyer\')">💬 View Thread</button>';
  } else if (order.status === "disputed") {
    action = '<span class="status-badge status-held">⚖️ Dispute under review — ' + (order.returnReason || "") + '</span>' +
      '<br><button class="ship-btn" onclick="openThread(\'' + order.ref + '\')">⚖️ Evidence / Admin Chat</button>' +
      '<br><span style="color:#b36b00;">An admin is reviewing this dispute. Your funds remain safely held until a ruling is made.</span>';
  } else if (order.status === "Shipped — on the way") {
    let _confirmButtons =
      '<span class="status-badge status-shipped">📦 Shipped! — Confirm delivery when it arrives</span>' +
      '<br><button class="ship-btn" style="background:#28a745;" onclick="releaseFunds(\'' + order.ref + '\')">✅ Confirm Delivery — Release Payment</button>' +
      '<br><button class="ship-btn" style="background:#d9534f;" onclick="openReturn(\'' + order.ref + '\')">↩️ Request Return</button>';

    // Buyer's Extend button — only if ≤ 24h left and not yet extended
    const _hoursLeftConfirm = order.confirmDeadline
      ? (order.confirmDeadline - Date.now()) / (1000 * 60 * 60)
      : Infinity;
    const _buyerCanExtend = (!order.extensions || order.extensions.buyer === 0)
                          && _hoursLeftConfirm > 0
                          && _hoursLeftConfirm <= 24;
    if (_buyerCanExtend) {
      _confirmButtons +=
        '<br><button class="ship-btn" style="background:#f0ad4e;" onclick="extendConfirmDeadline(\'' + order.ref + '\')">🕐 Extend +3 days</button>';
    }

    _confirmButtons +=
      '<br><button class="ship-btn" style="background:#0d6efd;" onclick="openThread(\'' + order.ref + '\', \'buyer\')">💬 View Thread</button>';

    action = _confirmButtons;
  } else {
    // Paid — funds held in escrow
    action = '<span class="status-badge status-held">🔒 Funds held safely in escrow. Waiting for seller to deliver item</span>' +
      '<br><button class="ship-btn" style="background:#0d6efd;" onclick="openThread(\'' + order.ref + '\', \'buyer\')">💬 View Thread</button>';
  }

  card.innerHTML =
    '<div class="my-order-header" onclick="toggleMyOrder(\'' + detailId + '\')">' +
      '<span class="my-order-ref">' + escapeHtml(order.ref) + ' — ' + escapeHtml(getOrderDisplayName(order)) + '</span>' +
      '<span class="my-order-chevron" id="myorder-chev-' + detailId + '">▸</span>' +
    '</div>' +
    '<div class="my-order-row">💰 Total paid: <strong>GH₵ ' + Number(order.total).toLocaleString() + '</strong></div>' +
((order.quantity && order.quantity > 1)
  ? '<div class="my-order-row">📦 Quantity: <strong>' + order.quantity + '</strong></div>'
  : '') +
    '<div class="my-order-row">📅 ' + escapeHtml(order.date || "") + '</div>' +
    (countdown ? '<div class="my-order-row">' + countdown + '</div>' : '') +
    '<div class="my-order-detail" id="' + detailId + '">' +
      '<div style="margin-top:4px;">' + action + '</div>' +
    '</div>';

  return card;
}

// Toggle an order card's detail section
function toggleMyOrder(detailId) {
  const el = document.getElementById(detailId);
  const chev = document.getElementById("myorder-chev-" + detailId);
  if (!el) return;
  if (el.classList.contains("open")) {
    el.classList.remove("open");
    if (chev) chev.textContent = "▸";
  } else {
    el.classList.add("open");
    if (chev) chev.textContent = "▾";
  }
}

function releaseFunds(ref) {
  marketaConfirm(
    "✅ Confirm Delivery",
    "Did you receive the item in good condition?\n\nOnce you confirm, payment will be released to the seller.",
    function() { performReleaseFunds(ref); },
    null
  );
}

async function performReleaseFunds(ref) {
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) return;
  order.status = "Funds released to seller";
  order.releasedAt = Date.now();       // ← record when this happened
  try {
    await saveOrderToFirestore(order);
    // Reduce the listing's stock by the sold quantity
    await decrementListingQuantity(order);

    await loadOrdersFromFirestore();
    openOrders();
    loadListings();
    marketaToast("Payment released ✅");
  } catch (err) {
    marketaAlert("❌ Error", "Failed: " + err.message);
  }
}

function deleteOrder(ref) {
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) return;

  // Block deletion if order is still active
  const terminalStatuses = ["Funds released to seller", "refunded"];
  if (!terminalStatuses.includes(order.status)) {
    marketaAlert(
      "🚫 Can't delete",
      "This order is still active (" + order.status + ").\n\n" +
      "You can only delete an order after it's completed."
    );
    return;
  }

  marketaConfirm(
    "🗑 Delete Order",
    "Delete this order permanently?\n\nThis cannot be undone.",
    function() { performDeleteOrder(ref); },
    null
  );
}

async function performDeleteOrder(ref) {
  try {
    await deleteOrderFromFirestore(ref);
    await loadOrdersFromFirestore();
    openOrders();
    marketaToast("Order deleted");
  } catch (err) {
    marketaAlert("❌ Error", "Failed to delete: " + err.message);
  }
}

function closeOrders() {
  const page = document.getElementById("ordersModal");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("ordersModal");
}

// ============================================
// MY SHOP — Dashboard with incoming orders
// ============================================
let _myShopTab = "needsAction";

// ============================================
// DASHBOARD — Advanced seller view
// ============================================
async function openDashboard() {
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) { openAuthFromHeader(); return; }
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  const page = document.getElementById("dashboardPage");
  if (!page) return;

  page.style.display = "flex";
  document.body.classList.add("page-open");

  pushLayer("dashboardPage", closeDashboard);

  // Make sure data is fresh, then render
  if (allOrdersCache.length === 0) {
    await loadOrdersFromFirestore().catch(function (e) { console.warn(e); });
  }
  if (allListingsCache.length === 0) {
    await loadListingsFromFirestore().catch(function (e) { console.warn(e); });
  }

  renderDashboard();
}

function closeDashboard() {
  const page = document.getElementById("dashboardPage");
  if (page) page.style.display = "none";

  popLayer("dashboardPage");

  // If My Shop was underneath, bring it back
  if (_layerStack.some(function (l) { return l.id === "shopModal"; })) {
    const shopPage = document.getElementById("shopModal");
    if (shopPage) shopPage.style.display = "flex";
  } else {
    if (!hasAnotherPageOpen("dashboardPage")) {
      document.body.classList.remove("page-open");
    }
  }
}

// ============================================
// DASHBOARD — Data computation + render
// ============================================

// Returns true if the given ms timestamp falls within the
// current calendar month.
function _dashIsThisMonth(ms) {
  if (!ms) return false;
  const now = new Date();
  const d = new Date(ms);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// Computes every number the dashboard needs from local caches.
// Returns an object with all figures ready to paint.
function computeDashboardStats() {
  // My listings
  const myListings = allListingsCache.filter(function (l) {
    return l.sellerId === currentUserId;
  });
  const myListingIds = myListings.map(function (l) { return String(l.id); });

  // My incoming orders (orders where I'm the seller)
  const myOrders = allOrdersCache.filter(function (o) {
    return o.sellerId === currentUserId;
  });

  // ---- Released funds → real revenue ----
  const releasedOrders = myOrders.filter(function (o) {
    return o.status === "Funds released to seller";
  });

  let totalEarned = 0;
  let thisMonth = 0;

  releasedOrders.forEach(function (o) {
    const amt = Number(o.total) || 0;
    totalEarned += amt;

    // Prefer releasedAt, fall back to createdAt (for old orders)
    const releasedMs = o.releasedAt || o.createdAt || 0;
    if (_dashIsThisMonth(releasedMs)) {
      thisMonth += amt;
    }
  });

  // ---- Active orders → held in escrow ----
  const escrowStatuses = [
    "Paid — funds held in escrow",
    "Shipped — on the way",
    "returnRequested",
    "disputed"
  ];
  const activeOrders = myOrders.filter(function (o) {
    return escrowStatuses.indexOf(o.status) !== -1;
  });

  let inEscrow = 0;
  activeOrders.forEach(function (o) {
    inEscrow += Number(o.total) || 0;
  });

  // ---- Quick stats ----
  let totalViews = 0;
  myListings.forEach(function (l) {
    totalViews += Number(l.views) || 0;
  });

  const totalOrdersReceived = myOrders.length;

  const avgOrderValue = totalOrdersReceived > 0
    ? Math.round(releasedOrders.reduce(function (sum, o) { return sum + (Number(o.total) || 0); }, 0) / (releasedOrders.length || 1))
    : 0;

  // ---- Top listings by revenue earned ----
  // Group released orders by itemId
  const revenueByListing = {};
  const unitsByListing = {};

  releasedOrders.forEach(function (o) {
    const key = String(o.itemId);
    const amt = Number(o.total) || 0;
    const qty = Number(o.quantity) || 1;

    revenueByListing[key] = (revenueByListing[key] || 0) + amt;
    unitsByListing[key] = (unitsByListing[key] || 0) + qty;
  });

  const topListings = Object.keys(revenueByListing)
    .map(function (id) {
      const listing = allListingsCache.find(function (l) { return String(l.id) === id; });
      return {
        id: id,
        listing: listing || null,
        revenue: revenueByListing[id],
        units: unitsByListing[id]
      };
    })
    .filter(function (row) { return row.listing; })   // skip deleted listings
    .sort(function (a, b) { return b.revenue - a.revenue; })
    .slice(0, 5);                                     // top 5

  return {
    totalEarned: totalEarned,
    thisMonth: thisMonth,
    inEscrow: inEscrow,
    pendingCount: activeOrders.length,
    totalViews: totalViews,
    totalOrdersReceived: totalOrdersReceived,
    avgOrderValue: avgOrderValue,
    topListings: topListings
  };
}

// Fetches this seller's average rating from the reviews collection.
// Returns a formatted string like "⭐ 4.6 (12)" or "⭐ —".
async function loadDashboardRating() {
  if (!currentUserId) return "⭐ —";

  try {
    const { db, collection, query, where, getDocs } = await getFsModules();
    const q = query(collection(db, "reviews"), where("toId", "==", currentUserId));
    const snap = await getDocs(q);

    let total = 0;
    let count = 0;
    snap.forEach(function (d) {
      const r = d.data();
      // Only count reviews where I was rated as a seller
      if (r.role === "seller" && typeof r.stars === "number") {
        total += r.stars;
        count++;
      }
    });

    if (count === 0) return "⭐ —";
    const avg = (total / count).toFixed(1);
    return "⭐ " + avg + " (" + count + ")";
  } catch (err) {
    console.warn("Dashboard rating load failed:", err);
    return "⭐ —";
  }
}

// ============================================
// DASHBOARD — Sales chart (last 30 days)
// ============================================

// Returns an array of { date, revenue } for the last 30 days.
// Today is index 29; the oldest day is index 0.
function computeDailySalesLast30Days() {
  const days = [];
  const now = new Date();

  // Build the buckets — 30 empty days
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({
      date: d,
      revenue: 0
    });
  }

  // My released orders
  const releasedOrders = allOrdersCache.filter(function (o) {
    return o.sellerId === currentUserId && o.status === "Funds released to seller";
  });

  // Add each order's revenue to its day bucket
  releasedOrders.forEach(function (o) {
    const ms = o.releasedAt || o.createdAt || 0;
    if (!ms) return;

    const orderDate = new Date(ms);
    const orderDay = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());

    // Find the matching bucket
    const bucket = days.find(function (d) {
      return d.date.getTime() === orderDay.getTime();
    });
    if (bucket) {
      bucket.revenue += Number(o.total) || 0;
    }
  });

  return days;
}

// Renders the sales chart into the Dashboard.
function renderDashboardSalesChart() {
  const chartEl = document.getElementById("dashSalesChart");
  const emptyEl = document.getElementById("dashSalesEmpty");
  const totalLine = document.getElementById("dashSalesTotalLine");
  if (!chartEl || !emptyEl) return;

  const days = computeDailySalesLast30Days();

  // Sum + max
  let total = 0;
  let max = 0;
  days.forEach(function (d) {
    total += d.revenue;
    if (d.revenue > max) max = d.revenue;
  });

  // No sales at all
  if (total === 0) {
    chartEl.style.display = "none";
    emptyEl.style.display = "block";
    if (totalLine) totalLine.textContent = "—";
    return;
  }

  chartEl.style.display = "flex";
  emptyEl.style.display = "none";

  if (totalLine) {
    totalLine.textContent = "GH₵ " + total.toLocaleString() + " in the last 30 days";
  }

  // Build the bars
  chartEl.innerHTML = "";

  days.forEach(function (d) {
    const wrap = document.createElement("div");
    wrap.className = "dash-sales-bar-wrap";

    const bar = document.createElement("div");
    bar.className = "dash-sales-bar";
    if (d.revenue === 0) {
      bar.classList.add("empty");
      bar.style.height = "2px";
    } else {
      // Bar height as a % of the tallest day
      const pct = Math.max(8, (d.revenue / max) * 100);
      bar.style.height = pct + "%";
    }

    const tooltip = document.createElement("div");
    tooltip.className = "dash-sales-tooltip";
    const dayLabel = d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    tooltip.textContent = dayLabel + " · GH₵ " + d.revenue.toLocaleString();

    wrap.appendChild(bar);
    wrap.appendChild(tooltip);
    chartEl.appendChild(wrap);
  });

  // Add the axis line below the chart — first, middle, last date
  const existingAxis = chartEl.parentNode.querySelector(".dash-sales-axis");
  if (existingAxis) existingAxis.remove();

  const axis = document.createElement("div");
  axis.className = "dash-sales-axis";

  const firstDate = days[0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const midDate = days[14].date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const lastDate = days[29].date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  axis.innerHTML =
    "<span>" + firstDate + "</span>" +
    "<span>" + midDate + "</span>" +
    "<span>" + lastDate + "</span>";

  chartEl.parentNode.insertBefore(axis, chartEl.nextSibling);
}

// Paints every number/row into the Dashboard DOM.
function renderDashboard() {
  const stats = computeDashboardStats();

  // ---- Revenue cards ----
  const setText = function (id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText("dashTotalEarned", "GH₵ " + stats.totalEarned.toLocaleString());
  setText("dashThisMonth", "GH₵ " + stats.thisMonth.toLocaleString());
  setText("dashInEscrow", "GH₵ " + stats.inEscrow.toLocaleString());
  setText("dashPendingCount", String(stats.pendingCount));

  // ---- Quick stats ----
  setText("dashTotalViews", stats.totalViews.toLocaleString());
  setText("dashTotalOrders", String(stats.totalOrdersReceived));
  setText("dashAvgOrder", "GH₵ " + stats.avgOrderValue.toLocaleString());

  // Rating — fetch asynchronously (Step 3)
const ratingEl = document.getElementById("dashRating");
if (ratingEl) {
  ratingEl.textContent = "…";
  loadDashboardRating().then(function (text) {
    // Only update if the Dashboard page is still open
    const page = document.getElementById("dashboardPage");
    if (page && page.style.display === "flex") {
      ratingEl.textContent = text;
    }
  }).catch(function () {
    ratingEl.textContent = "—";
  });
}

// ---- Small nudge for new sellers with no sales yet ----
const revenueGrid = document.getElementById("dashRevenueGrid");
if (revenueGrid) {
  // Find or create the nudge element
  let nudge = document.getElementById("dashNewSellerNudge");
  if (stats.totalEarned === 0 && stats.inEscrow === 0) {
    if (!nudge) {
      nudge = document.createElement("div");
      nudge.id = "dashNewSellerNudge";
      nudge.className = "dash-new-seller-nudge";
      nudge.innerHTML =
        '🌱 <strong>You\'re just getting started.</strong> ' +
        'Once your first order is released, your earnings will appear here.';
      revenueGrid.parentNode.insertBefore(nudge, revenueGrid.nextSibling);
    }
  } else {
    // Seller has real numbers — hide the nudge if it exists
    if (nudge) nudge.remove();
  }
}

// ---- Sales chart ----
renderDashboardSalesChart();

  // ---- Top listings ----
  const listEl = document.getElementById("dashTopListings");
  const emptyEl = document.getElementById("dashTopEmpty");
  if (!listEl || !emptyEl) return;

  listEl.innerHTML = "";

  if (stats.topListings.length === 0) {
    listEl.style.display = "none";
    emptyEl.style.display = "block";
  } else {
    listEl.style.display = "flex";
    emptyEl.style.display = "none";

    stats.topListings.forEach(function (row) {
      const card = document.createElement("div");
      card.className = "dash-top-row";

      const photos = (row.listing.photos && row.listing.photos.length > 0)
        ? row.listing.photos
        : (row.listing.photo ? [row.listing.photo] : []);
      const thumb = photos[0] || null;

      card.innerHTML =
        '<div class="dash-top-thumb">' +
          (thumb ? '<img src="' + thumb + '" alt="">' : '📦') +
        '</div>' +
        '<div class="dash-top-info">' +
          '<div class="dash-top-title">' + escapeHtml(formatTitle(row.listing.name)) + '</div>' +
          '<div class="dash-top-meta">' + row.units + ' sold · GH₵ ' + Number(row.listing.price).toLocaleString() + ' each</div>' +
        '</div>' +
        '<div class="dash-top-earned">GH₵ ' + Number(row.revenue).toLocaleString() + '</div>';

      listEl.appendChild(card);
    });
  }
}

async function openShop() {
  // Trust the subscriptions if they're already warmed up
  if (allOrdersCache.length === 0) {
    await loadOrdersFromFirestore();
  }
  if (allListingsCache.length === 0) {
    await loadListingsFromFirestore();
  }

  const page = document.getElementById("shopModal");
  if (!page) return;

  // Reset to "Needs action" tab each time
  _myShopTab = "needsAction";
  document.querySelectorAll(".shop-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === "needsAction");
  });

  renderMyShop();

  page.style.display = "flex";

  // Tell the layer manager we're open
  pushLayer("shopModal", closeShop);
}

function closeShop() {
  const page = document.getElementById("shopModal");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("shopModal");
}

// Tab switching
function filterMyShopOrders(tab) {
  _myShopTab = tab;
  document.querySelectorAll(".shop-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  renderMyShop();
}

// ============================================
// COMPUTE SHOP STATS
// ============================================
function computeShopStats() {
  // My listings
  const myListings = allListingsCache.filter(function (l) {
    return l.sellerId === currentUserId;
  });
  const activeListings = myListings.filter(function (l) { return !l.sold; }).length;
  const soldListings = myListings.filter(function (l) { return !!l.sold; }).length;

  // My incoming orders (orders for my listings)
  const myListingIds = myListings.map(function (l) { return l.id; });
  const myOrders = allOrdersCache.filter(function (o) {
    return o.itemId && myListingIds.indexOf(o.itemId) !== -1;
  });

  const ordersReceived = myOrders.length;

  // Funds in escrow = sum of totals where money is still held
  const escrowStatuses = [
    "Paid — funds held in escrow",
    "Shipped — on the way",
    "returnRequested",
    "disputed"
  ];
  let escrowTotal = 0;
  myOrders.forEach(function (o) {
    if (escrowStatuses.indexOf(o.status) !== -1) {
      escrowTotal += Number(o.total) || 0;
    }
  });

  return {
    activeListings: activeListings,
    soldListings: soldListings,
    ordersReceived: ordersReceived,
    escrowFunds: escrowTotal,
    myOrders: myOrders
  };
}

// ============================================
// RENDER MY SHOP
// ============================================
function renderMyShop() {
  const stats = computeShopStats();

  // Stat cards
  const activeEl = document.getElementById("shopActiveCount");
  const soldEl = document.getElementById("shopSoldCount");
  const ordersEl = document.getElementById("shopOrdersCount");
  const escrowEl = document.getElementById("shopEscrowFunds");

  if (activeEl) activeEl.textContent = stats.activeListings;
  if (soldEl) soldEl.textContent = stats.soldListings;
  if (ordersEl) ordersEl.textContent = stats.ordersReceived;
  if (escrowEl) escrowEl.textContent = "GH₵ " + stats.escrowFunds.toLocaleString();

  // Sort orders newest first
  const orders = stats.myOrders.slice().sort(function (a, b) {
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  // Filter by tab
  let shown = orders;
  if (_myShopTab === "needsAction") {
    shown = orders.filter(function (o) {
      return o.status === "Paid — funds held in escrow" ||
             o.status === "returnRequested" ||
             o.status === "disputed";
    });
  } else if (_myShopTab === "completed") {
    shown = orders.filter(function (o) {
      return o.status === "Funds released to seller" ||
             o.status === "refunded";
    });
  }

  // Render
  const list = document.getElementById("shopOrdersList");
  const empty = document.getElementById("shopOrdersEmpty");
  const emptyTitle = document.getElementById("shopEmptyTitle");
  const emptyText = document.getElementById("shopEmptyText");
  if (!list || !empty) return;

  list.innerHTML = "";

  if (shown.length === 0) {
    empty.style.display = "block";
    if (_myShopTab === "needsAction") {
      if (emptyTitle) emptyTitle.textContent = "No orders waiting to ship";
      if (emptyText) emptyText.textContent = "You're all caught up. New orders that need shipping will appear here.";
    } else if (_myShopTab === "completed") {
      if (emptyTitle) emptyTitle.textContent = "No completed orders yet";
      if (emptyText) emptyText.textContent = "Orders you've completed (delivered or refunded) will appear here.";
    } else {
      if (emptyTitle) emptyTitle.textContent = "No incoming orders yet";
      if (emptyText) emptyText.textContent = "Once buyers purchase from you, their orders will appear here.";
    }
    return;
  }

  empty.style.display = "none";

  shown.forEach(function (order) {
    list.appendChild(createShopOrderCard(order));
  });
}

// ============================================
// BUILD ONE ORDER CARD
// ============================================
function createShopOrderCard(order) {
  const card = document.createElement("div");
  card.className = "shop-order-card";

  const countdown = getOrderCountdown(order);
  const detailId = "shop-d-" + order.ref;

  // Build the action buttons
  let action = "";
  const shipped = order.status === "Shipped — on the way";
  const released = order.status === "Funds released to seller";

  if (released) {
    const alreadyRated = order.sellerRatedBuyer === true;
    const rateBtn = alreadyRated
      ? '<br><span style="color:#28a745;font-size:13px;">⭐ You rated this buyer</span>'
      : '<br><button class="ship-btn" style="background:#f0ad4e;" onclick="openReviewModal(\'' + order.ref + '\', \'buyer\')">⭐ Rate this Buyer</button>';
    action = '<span class="status-badge status-released">✅ Delivered — Payment Released</span>' +
      rateBtn +
      '<br><button class="ship-btn" style="background:#0d6efd;margin-right:6px;margin-top:6px;" onclick="openThread(\'' + order.ref + '\', \'seller\')">💬 View Thread</button>' +
      '<button class="ship-btn" style="background:#d9534f;margin-top:6px;" onclick="deleteSellerOrder(\'' + order.ref + '\')">🗑 Remove</button>';
  } else if (shipped) {
    action = '<span class="status-badge status-shipped">🚚 Shipped — awaiting buyer confirmation</span>' +
      '<br><button class="ship-btn" style="background:#0d6efd;" onclick="openThread(\'' + order.ref + '\', \'seller\')">💬 View Thread</button>';
  } else if (order.status === "returnRequested") {
    action = '<span class="status-badge status-held">⚠️ RETURN REQUESTED — ' + (order.returnReason || "Item doesn\'t match description") + '</span>' +
      '<br><span style="color:#b36b00;">📦 The buyer is shipping the item back to you. When it arrives, refund them below.</span>' +
      '<br><button class="ship-btn" style="background:#d9534f;" onclick="refundBuyer(\'' + order.ref + '\')">💸 Refund Buyer</button>' +
      '<br><button class="ship-btn" style="background:#676e22;margin-top:6px;" onclick="disputeOrder(\'' + order.ref + '\')">⚖️ Dispute — Ask Admin</button>';
  } else if (order.status === "refunded") {
    const alreadyRatedRef = order.sellerRatedBuyer === true;
    const rateBtnRef = alreadyRatedRef
      ? '<br><span style="color:#28a745;font-size:13px;">⭐ You rated this buyer</span>'
      : '<br><button class="ship-btn" style="background:#f0ad4e;" data-ref="' + order.ref + '" onclick="rateBuyerFromData(this)">⭐ Rate this Buyer</button>';
    action = '<span class="status-badge status-held">📦 Order Refunded — no payment released</span>' +
      rateBtnRef +
      '<br><button class="ship-btn" style="background:#0d6efd;margin-right:6px;margin-top:6px;" onclick="openThread(\'' + order.ref + '\', \'seller\')">💬 View Thread</button>' +
      '<button class="ship-btn" style="background:#d9534f;margin-top:6px;" onclick="deleteSellerOrder(\'' + order.ref + '\')">🗑 Remove</button>';
  } else if (order.status === "disputed") {
    action = '<span class="status-badge status-held">⚖️ Buyer disputes this order — admin reviewing. Funds frozen.</span>' +
      '<br><button class="ship-btn" onclick="openThread(\'' + order.ref + '\', \'seller\')">⚖️ Evidence / Admin Chat</button>';
  } else {
    // Paid — funds held in escrow (needs action)
    const hoursLeft = (order.shipDeadline - Date.now()) / (1000 * 60 * 60);
    const sellerCanExtend = (!order.extensions || order.extensions.seller === 0)
                          && hoursLeft > 0
                          && hoursLeft <= 24;
    let shipButtons = '<button class="ship-btn" onclick="markShipped(\'' + order.ref + '\')">🚚 Mark as Shipped</button>';
    if (sellerCanExtend) {
      shipButtons +=
        '<br><button class="ship-btn" style="background:#f0ad4e;margin-top:6px;" onclick="extendShipDeadline(\'' + order.ref + '\')">🕐 Extend +2 days</button>';
    }
    shipButtons +=
      '<br><button class="ship-btn" style="background:#0d6efd;margin-top:6px;" onclick="openThread(\'' + order.ref + '\', \'seller\')">💬 View Thread</button>';
    action = shipButtons;
  }

  card.innerHTML =
    '<div class="shop-order-header" onclick="toggleShopOrder(\'' + detailId + '\')">' +
      '<span class="shop-order-ref">' + escapeHtml(order.ref) + ' — ' + escapeHtml(getOrderDisplayName(order)) + '</span>' +
      '<span class="shop-order-chevron" id="shop-chev-' + detailId + '">▸</span>' +
    '</div>' +
    '<div class="shop-order-row">💰 <strong>GH₵ ' + Number(order.total).toLocaleString() + '</strong>' + escrowLabel(order) + '</div>' +
((order.quantity && order.quantity > 1)
  ? '<div class="shop-order-row">📦 Quantity: <strong>' + order.quantity + '</strong></div>'
  : '') +
    (countdown ? '<div class="shop-order-row">' + countdown + '</div>' : '') +
    '<div class="shop-order-detail" id="' + detailId + '">' +
      '<div class="shop-order-row">📞 Buyer: ' + escapeHtml(order.buyerPhone || "—") + '</div>' +
'<div class="shop-order-row">' + locationIcon() + ' ' + escapeHtml(order.buyerLocation || "—") + '</div>' +
'<div style="margin-top:12px;">' + action + '</div>' +
    '</div>';

  return card;
}

// Toggle an order card's detail section
function toggleShopOrder(detailId) {
  const el = document.getElementById(detailId);
  const chev = document.getElementById("shop-chev-" + detailId);
  if (!el) return;
  if (el.classList.contains("open")) {
    el.classList.remove("open");
    if (chev) chev.textContent = "▸";
  } else {
    el.classList.add("open");
    if (chev) chev.textContent = "▾";
  }
}

function markShipped(ref) {
  marketaConfirm(
    "🚚 Mark as Shipped",
    "Mark this order as shipped?\n\nThe buyer will be notified and given 7 days to confirm delivery.",
    function() { performMarkShipped(ref); },
    null
  );
}

async function performMarkShipped(ref) {
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) return;

  order.status = "Shipped — on the way";

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  order.confirmDeadline = Date.now() + SEVEN_DAYS_MS;

  // Log the ship event in the order thread so both sides have a record
  if (!order.thread) order.thread = [];
  order.thread.push({
    from: "system",
    text: "📦 Seller marked this order as shipped. Buyer has 7 days to confirm delivery.",
    time: new Date().toLocaleString(),
    sentAt: Date.now()
  });

  try {
    await saveOrderToFirestore(order);
    await loadOrdersFromFirestore();
    openShop();
    marketaToast("Marked as shipped 🚚");
  } catch (err) {
    marketaAlert("❌ Error", "Failed: " + err.message);
  }
}

function deleteListing(index) {
  const item = allListingsCache[index];
  if (!item) {
    marketaAlert("⚠️ Not Found", "Listing not found.");
    return;
  }

  // Block deletion if this listing has any active order
  const terminalStatuses = ["Funds released to seller", "refunded"];
  const activeOrder = allOrdersCache.find(function(o) {
    return o.itemId === item.id && !terminalStatuses.includes(o.status);
  });

  if (activeOrder) {
    marketaAlert(
      "🚫 Can't delete",
      "This listing has an active order (" + activeOrder.ref + " — " + activeOrder.status + ").\n\n" +
      "You can only delete a listing once its order is completed (delivered, refunded, or cancelled)."
    );
    return;
  }

  marketaConfirm(
    "🗑 Delete Listing",
    "Delete \"" + formatTitle(item.name) + "\" permanently?\n\nThis cannot be undone.",
    function() { performDeleteListing(index); },
    null
  );
}

async function performDeleteListing(index) {
  const item = allListingsCache[index];
  if (!item) return;

  // Re-check (in case order arrived between tapping Delete and Confirm)
  const terminalStatuses = ["Funds released to seller", "refunded"];
  const activeOrder = allOrdersCache.find(function(o) {
    return o.itemId === item.id && !terminalStatuses.includes(o.status);
  });

  if (activeOrder) {
    marketaAlert(
      "🚫 Can't delete",
      "An order for this listing just became active. Complete or cancel it first."
    );
    return;
  }

  try {
    const { db, doc, deleteDoc } = await getFsModules();
    await deleteDoc(doc(db, "listings", String(item.id)));
    marketaToast("Listing deleted 🗑");
    closeShop();
    await loadListingsFromFirestore();
const sb = document.getElementById("searchBox");
if (sb) sb.value = "";
const rc = document.getElementById("resultCount");
if (rc) rc.style.display = "none";
renderListings(allListingsCache);

// Refresh whichever view is open
const listingsModalOpen = document.getElementById("listingsModal").classList.contains("show");
if (listingsModalOpen) {
  openMyListings();
}
  } catch (err) {
    marketaAlert("❌ Error", "Failed to delete: " + err.message);
  }
}

function startEditListing(index) {
  const item = allListingsCache[index];
  if (!item) {
    alert("Listing not found. 🙏");
    return;
  }
  
  const orders = allOrdersCache.slice();
  const terminalStatuses = ["Funds released to seller", "refunded"];
  const hasActiveOrder = orders.some(function(o) {
    return o.itemId === item.id && !terminalStatuses.includes(o.status);
  });
  if (hasActiveOrder) {
    alert("🚫 This listing is in an active order and can't be edited. Finish or cancel the order first.");
    return;
  }
  editingListingIndex = index;
  document.getElementById("itemName").value = item.name || "";
document.getElementById("itemPrice").value = item.price || "";
document.getElementById("itemQuantity").value = (item.quantity !== undefined ? item.quantity : 1);
document.getElementById("itemLocation").value = item.location || "";
  const regionEl = document.getElementById("itemRegion");
if (regionEl) regionEl.value = item.region || "";
  document.getElementById("itemDescription").value = item.description || "";
  document.getElementById("itemNegotiable").checked = !!item.negotiable;
  document.getElementById("itemCategory").value = item.category || "";
  updateSubCategoryDropdown(item.subCategory || "");
  document.getElementById("itemCondition").value = item.condition || "";
  currentPhotos = (item.photos && item.photos.length > 0) ? item.photos.slice() : (item.photo ? [item.photo] : []);
  renderPhotoStrip();
  loadDetailRows(item.details || []);
  closeShop();
closeMyListings();

// Open the wizard in edit mode
_sellPublishMode = true;
currentSellStep = 1;
updateSellCounters();
renderSellStep();

document.getElementById("sellModal").classList.add("show");
pushLayer("sellModal", toggleSellPage);
}

async function postListing() {
  const rawPrice = document.getElementById("itemPrice").value;
  const regionEl = document.getElementById("itemRegion");
const qtyEl = document.getElementById("itemQuantity");
const quantityValue = qtyEl ? Number(qtyEl.value) : 1;
const item = {
  name: document.getElementById("itemName").value.trim(),
  price: Number(rawPrice),
  location: document.getElementById("itemLocation").value,
  region: regionEl ? regionEl.value : "",
  category: document.getElementById("itemCategory").value,
  subCategory: document.getElementById("itemSubCategory").value,
  condition: document.getElementById("itemCondition").value,
  description: document.getElementById("itemDescription").value,
  negotiable: document.getElementById("itemNegotiable").checked,
  photos: currentPhotos,
  sellerId: currentUserId,
  details: getDetailRows(),
  quantity: quantityValue,
  views: 0
};

  try {
    const { db, doc, setDoc } = await getFsModules();

    if (editingListingIndex !== null) {
      const existing = allListingsCache[editingListingIndex];
    if (!existing) { marketaAlert("Not found", "Listing not found. 🙏"); return; }

            const updated = {
  ...existing,
  name: item.name,
  price: item.price,
  location: item.location,
  region: item.region,
  category: item.category,
  subCategory: item.subCategory,
  condition: item.condition,
  description: item.description,
  negotiable: item.negotiable,
  photos: item.photos,
  details: item.details,
  quantity: item.quantity
};

      await setDoc(doc(db, "listings", String(existing.id)), updated);
      resetSellForm();
      toggleSellPage();
      await loadListingsFromFirestore();
      renderListings(allListingsCache);
      marketaToast("Listing updated ✏️");
return;
    }

    item.id = Date.now();
    item.postedAt = Date.now();

    await setDoc(doc(db, "listings", String(item.id)), item);
    
    resetSellForm();
    toggleSellPage();
    await loadListingsFromFirestore();
    renderListings(allListingsCache);
    marketaToast("Listing posted 🎉");
  } catch (err) {
  marketaAlert("❌ Error", "Failed to save: " + err.message);
}
}

async function toggleSold(index) {
  const item = allListingsCache[index];
  if (!item) return;
  try {
    const { db, doc, setDoc } = await getFsModules();
    const updated = { ...item, sold: !item.sold };
    await setDoc(doc(db, "listings", String(item.id)), updated);
    await loadListingsFromFirestore();

    // Refresh whichever view is open
    const listingsPage = document.getElementById("listingsModal");
    if (listingsPage && listingsPage.style.display === "flex") {
      renderMyListings();
    }

    const shopOpen = document.getElementById("shopModal").classList.contains("show");
    if (shopOpen) {
      openShop();
    }

    renderListings(allListingsCache);

    marketaToast(updated.sold ? "Marked as sold ✅" : "Listing relisted ✅");
  } catch (err) {
    marketaAlert("❌ Error", "Failed: " + err.message);
  }
}

// ============================================
// FILTERS & SEARCH
// ============================================
function applyFilters() {
  const query = document.getElementById("searchBox").value.toLowerCase().trim();
  const condition = document.getElementById("filterCondition").value.toLowerCase().trim();
  const minPrice = Number(document.getElementById("minPrice").value) || 0;
  const maxPrice = Number(document.getElementById("maxPrice").value) || Infinity;
  const listings = document.querySelectorAll(".listing");

  let visibleCount = 0;

  listings.forEach(function(listing) {
    const cardName = listing.dataset.name || "";
    const cardLocation = listing.dataset.location || "";
    const cardCategory = listing.dataset.category || "";
    const cardCondition = listing.dataset.condition || "";

    const priceText = listing.querySelector(".price").textContent;
    const price = Number(priceText.replace(/[^0-9]/g, ""));

    // Search across name, location, and category
    const matchesSearch = query === "" ||
      cardName.includes(query) ||
      cardLocation.includes(query) ||
      cardCategory.includes(query);

    // Condition must match exactly (New / Used / Refurbished)
    const matchesCondition = condition === "" || cardCondition === condition;

    const matchesPrice = price >= minPrice && price <= maxPrice;
    const visible = matchesSearch && matchesCondition && matchesPrice;
    listing.style.display = visible ? "block" : "none";
    if (visible) visibleCount++;
  });

  updateResultCount(visibleCount, query, condition, minPrice, maxPrice);
}

function updateResultCount(count, query, condition, minPrice, maxPrice) {
  const banner = document.getElementById("resultCount");
  if (!banner) return;

  const hasFilter = query !== "" || condition !== "" ||
                    minPrice > 0 || maxPrice !== Infinity;

  if (!hasFilter) {
    banner.style.display = "none";
    return;
  }

  // Build a description of what's being filtered
  const parts = [];
  if (query) parts.push('"' + query + '"');
  if (condition) parts.push(condition);
  if (minPrice > 0 && maxPrice !== Infinity) parts.push("GH₵" + minPrice + "–" + maxPrice);
  else if (minPrice > 0) parts.push("over GH₵" + minPrice);
  else if (maxPrice !== Infinity) parts.push("under GH₵" + maxPrice);

  const label = parts.join(" · ");
  const countWord = count === 1 ? "result" : "results";

  banner.textContent = "🔍 " + count + " " + countWord + " for " + label;
  banner.style.display = "block";
}

function searchListings() { applyFilters(); }

// ============================================
// SEARCH BOX AUTOFILL GUARD
// Chrome/Android sometimes stuffs an email into
// text inputs after login. This clears it.
// ============================================
function startSearchBoxGuard() {
  const sb = document.getElementById("searchBox");
  if (!sb) return;

  // Clear immediately
  sb.value = "";
  const rc = document.getElementById("resultCount");
  if (rc) rc.style.display = "none";

  // Watch for 3 seconds — anything sneaking in gets wiped
  let ticks = 0;
  const guard = setInterval(function() {
    ticks++;
    const box = document.getElementById("searchBox");
    if (!box) { clearInterval(guard); return; }

    const val = box.value || "";
    const looksLikeAutofill = val.includes("@") || val.includes("gmail") || val.includes(".com");

    if (looksLikeAutofill) {
      box.value = "";
      const banner = document.getElementById("resultCount");
      if (banner) banner.style.display = "none";
      // Re-render the full listing grid so no phantom filtering remains
      renderListings(allListingsCache);
    }

    if (ticks >= 10) clearInterval(guard); // stop after 3s
  }, 300);
}

// Kick it off as soon as the page loads
window.addEventListener("load", startSearchBoxGuard);
// And also every time auth finishes (user logs in)
window.addEventListener("firebase-ready", function() {
  setTimeout(startSearchBoxGuard, 500);
});

function openAllCategories() {
  document.getElementById("allCategoriesModal").classList.add("show");

  // Refresh category counts so they appear in the modal too
  updateCategoryCounts();

  // Tell the layer manager we're open
  pushLayer("allCategoriesModal", closeAllCategories);
}

function closeAllCategories() {
  document.getElementById("allCategoriesModal").classList.remove("show");

  // Tell the layer manager we're closed
  popLayer("allCategoriesModal");
}
function pickCategory(category) { closeAllCategories(); filterCategory(category); }

function filterCategory(category) {
  const listingsDiv = document.querySelector(".listings");
  listingsDiv.innerHTML = "";
  let count = 0;
  allListingsCache.forEach(function(item, index) {
    if (item.category === category) {
      listingsDiv.appendChild(createCard(item, index));
      count++;
    }
  });
  const banner = document.getElementById("filterBanner");
  banner.innerHTML =
    '<span>' + category + ' • ' + count + ' item' + (count === 1 ? '' : 's') + '</span>' +
    '<button class="clear-btn" onclick="clearCategoryFilter()">✕ Show All</button>';
  banner.style.display = "flex";
  listingsDiv.scrollIntoView({ behavior: "smooth" });
}

function clearCategoryFilter() {
  document.getElementById("filterBanner").style.display = "none";
  loadListings();
}

// ============================================
// RETURN / REFUND / DISPUTE
// ============================================
var currentReturnRef = null;

function openReturn(ref) {
  currentReturnRef = ref;
  document.getElementById("returnModal").style.display = "flex";

  // Tell the layer manager we're open
  pushLayer("returnModal", closeReturn);
}
function closeReturn() {
  currentReturnRef = null;
  document.getElementById("returnModal").style.display = "none";

  // Tell the layer manager we're closed
  popLayer("returnModal");
}

async function submitReturn() {
  const reason = document.getElementById("returnReason").value;
  const note = document.getElementById("returnNote").value;
  const order = allOrdersCache.find(function(o) { return o.ref === currentReturnRef; });
  if (!order) return;
  order.status = "returnRequested";
  order.returnReason = reason;
  if (note) order.returnNote = note;
  try {
    await saveOrderToFirestore(order);
    await loadOrdersFromFirestore();
    closeReturn();
    openOrders();
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}

async function refundBuyer(ref) {
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) return;
  order.status = "refunded";
  try {
    await saveOrderToFirestore(order);

    // Restore the stock that was decremented (if any)
    await restoreListingQuantity(order);

    await loadOrdersFromFirestore();
    openShop();
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}

async function disputeOrder(ref) {
  if (!confirm("Escalate this order to the Marketa admin? Held funds will be frozen until a ruling is made.")) return;
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) return;
  order.status = "disputed";
  order.disputedAt = new Date().toLocaleDateString();
  try {
    await saveOrderToFirestore(order);
    await loadOrdersFromFirestore();
    openShop();
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}

// ============================================
// ADMIN
// ============================================
async function checkIsAdminAndOpen() {
  if (!currentAuthUser) return;
  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", currentAuthUser.uid));
    if (snap.exists() && snap.data().isAdmin === true) {
      openAdmin();
    }
    // Otherwise: silently do nothing (the tapper is not an admin)
  } catch (err) {
    console.warn("Admin check failed:", err);
  }
}

async function openAdmin() {
  await loadOrdersFromFirestore();
  window.scrollTo(0, 0);
  document.querySelector("header").style.display = "none";
  document.querySelector("main").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";

  const orders = allOrdersCache.slice();
  orders.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  const disputes = orders.filter(function(order) { return order.status === "disputed"; });
  const box = document.getElementById("adminDisputes");
  if (disputes.length === 0) {
    box.innerHTML = '<p>✅ No active disputes. All is calm.</p>';
    return;
  }
  box.innerHTML = disputes.map(function(order) {
  const msgCount = (order.thread || []).length;

  return '<div class="order-card" style="cursor:pointer;" ' +
      'onclick="openThread(\'' + order.ref + '\', \'admin\')">' +
    '<b>' + order.ref + '</b> — ' + escapeHtml(getOrderDisplayName(order)) + '<br>' +
    '💰 GH₵ ' + order.total + '<br>' +
    '⚠️ Reason: ' + (order.returnReason || "Not stated") + '<br>' +
    (order.returnNote ? '📝 Note: ' + order.returnNote + '<br>' : '') +
    '📅 Disputed: ' + (order.disputedAt || "") + '<br>' +
    '💬 ' + msgCount + ' message' + (msgCount === 1 ? '' : 's') + ' in thread<br><br>' +
    '<button class="ship-btn" onclick="event.stopPropagation(); openThread(\'' + order.ref + '\', \'admin\')">💬 Open Thread</button>' +
    '</div>';
}).join("");
}

function closeAdmin() {
  document.getElementById("adminPanel").style.display = "none";
  document.querySelector("header").style.display = "";
  document.querySelector("main").style.display = "";
  window.scrollTo(0, 0);
}

async function adminReply(ref) {
  const input = document.getElementById("reply-" + ref);
  const text = input.value.trim();
  if (!text) {
    alert("Type a reply first! 🙏");
    return;
  }
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) return;
  if (!order.thread) order.thread = [];
  order.thread.push({ from: "admin", text: text, time: new Date().toLocaleString() });
  try {
    await saveOrderToFirestore(order);
    await loadOrdersFromFirestore();
    openAdmin();
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}

async function adminRuling(ref, ruling) {
  if (!confirm("Are you sure? This ruling is final.")) return;
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) return;
  order.status = (ruling === "refund") ? "refunded" : "Funds released to seller";
  order.ruledBy = "admin";
  if (!order.thread) order.thread = [];
  order.thread.push({
    from: "admin",
    text: (ruling === "refund") ? "⚖️ FINAL RULING: Refund approved. The buyer will be refunded from escrow." : "⚖️ FINAL RULING: Funds released to the seller. Case closed.",
    time: new Date().toLocaleString()
  });
  try {
    await saveOrderToFirestore(order);
    // Adjust listing stock based on ruling
if (ruling === "refund") {
  await restoreListingQuantity(order);
} else {
  await decrementListingQuantity(order);
}
    await loadOrdersFromFirestore();
    openAdmin();
    loadListings();
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}

function toggleOrder(id) {
  const el = document.getElementById(id);
  const chev = document.getElementById("chev-" + id);
  if (el.style.display === "block") {
    el.style.display = "none";
    chev.textContent = "▸";
  } else {
    el.style.display = "block";
    chev.textContent = "▾";
  }
}

async function deleteSellerOrder(ref) {
  try {
    await deleteOrderFromFirestore(ref);
    await loadOrdersFromFirestore();
    openShop();
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}

// ============================================
// CHAT
// ============================================
let threadRef = null;
let threadRole = "buyer";

// Real-time listener for the currently open buyer↔seller thread
let activeThreadUnsubscribe = null;

// Heartbeat that re-renders the typing indicator every second
// while a buyer↔seller chat is open. Without this, the indicator
// would only update when a new message arrived — meaning it could
// stay visible for a long time after the other person stopped.
let _typingHeartbeatTimer = null;

function startTypingHeartbeat() {
  stopTypingHeartbeat();
  _typingHeartbeatTimer = setInterval(function () {
    if (chatMode !== "bs" || !currentThreadId) return;
    const thread = allThreadsCache.find(function (t) { return t.id === currentThreadId; });
    if (!thread) return;
    renderTypingIndicator(thread);
  }, 1000);
}

function stopTypingHeartbeat() {
  if (_typingHeartbeatTimer) {
    clearInterval(_typingHeartbeatTimer);
    _typingHeartbeatTimer = null;
  }
}

// Subscribe to a thread document for live updates
async function subscribeToThread(threadId) {
  // Cancel any previous subscription
  if (activeThreadUnsubscribe) {
    activeThreadUnsubscribe();
    activeThreadUnsubscribe = null;
  }

  try {
    const { db, doc, onSnapshot } = await getFsModules();

    // Start the typing heartbeat whenever we subscribe to a thread
    startTypingHeartbeat();

  activeThreadUnsubscribe = onSnapshot(
    doc(db, "threads", String(threadId)),
    function(docSnap) {
      if (!docSnap.exists()) return;
      const thread = docSnap.data();
      // Update the cache
      const idx = allThreadsCache.findIndex(function(t) { return t.id === thread.id; });
      if (idx >= 0) {
        allThreadsCache[idx] = thread;
      } else {
        allThreadsCache.push(thread);
      }
      // If this is the currently open thread, re-render
      if (chatMode === "bs" && currentThreadId === thread.id) {
        renderThread();
      }
    },
      function(err) {
        console.warn("Thread subscription error:", err);
      }
    );
  } catch (err) {
    console.warn("Could not subscribe to thread:", err);
  }
}

// Unsubscribe from the active thread
function unsubscribeFromThread() {
  if (activeThreadUnsubscribe) {
    activeThreadUnsubscribe();
    activeThreadUnsubscribe = null;
  }
}

async function openThread(ref, role) {
  chatMode = "dispute";
  threadRef = ref;
  threadRole = role || "buyer";
  
  // Dispute threads don't have a verified tick
const _chatTick = document.getElementById("chatHeaderVerified");
if (_chatTick) _chatTick.style.display = "none";

  // Save this chat as the last location so a refresh can restore it.
  saveLastLocation("threadModal", {
    mode: "dispute",
    ref: ref,
    role: threadRole
  });

  await loadOrdersFromFirestore();
const _order = allOrdersCache.find(function(o) { return o.ref === ref; });
const _isResolved = _order && (
  _order.status === "Funds released to seller" ||
  _order.status === "refunded"
);
const _isDisputed = _order && _order.status === "disputed";
  const _disputeHeaderTitle = document.getElementById("chatHeaderTitle");
if (_disputeHeaderTitle) {
  _disputeHeaderTitle.textContent =
    _isResolved ? "📦 Order Thread" :
    _isDisputed ? "⚖️ Evidence & Admin Chat" :
    "💬 Order Chat";
  renderThread();
  document.getElementById("threadModal").style.display = "flex";
  document.body.classList.add("chat-open");
  const sellBtn = document.querySelector(".sell-btn");
  if (sellBtn) sellBtn.style.display = "none";
  // Show admin ruling bar only when admin views a dispute
const rulingBar = document.getElementById("adminRulingBar");
if (rulingBar) {
  rulingBar.style.display = (chatMode === "dispute" && threadRole === "admin") ? "flex" : "none";
}
// If the order is resolved, hide the input and show the closed notice
const chatFooter = document.querySelector(".chat-footer");
const closedNotice = document.getElementById("closedChatNotice");
if (_isResolved) {
  if (chatFooter) chatFooter.style.display = "none";
  if (closedNotice) closedNotice.style.display = "block";
} else {
  if (chatFooter) chatFooter.style.display = "flex";
  if (closedNotice) closedNotice.style.display = "none";
}
  document.getElementById("threadInput").value = "";
  document.getElementById("threadImage").value = "";
  // Tell the layer manager we're open
  pushLayer("threadModal", closeThread);

  setTimeout(function() {
    const box = document.getElementById("threadMessages");
    if (box) box.scrollTop = box.scrollHeight;
  }, 50);
}
}

function closeThread() {
  unsubscribeFromThread();
  cancelEditMode();
  cancelReply();

  // Stop the typing heartbeat
  stopTypingHeartbeat();

  // Clear any pending typing signal so the other side doesn't
  // see "typing…" forever after we leave.
  try { clearTypingSignal(); } catch (e) {}
  if (_typingStopTimer) { clearTimeout(_typingStopTimer); _typingStopTimer = null; }
  _lastTypingWriteMs = 0;

  document.getElementById("threadModal").style.display = "none";
  document.body.classList.remove("chat-open");

  const _footer = document.querySelector(".chat-footer");
  if (_footer) _footer.style.display = "flex";

  // Reset the closed/block notice back to its default text
  const _notice = document.getElementById("closedChatNotice");
  if (_notice) {
    _notice.style.display = "none";
    _notice.innerHTML = "🔒 <strong>This order is closed.</strong> Chat is read-only.";
  }

  // Clear the block-check cache so a fresh check runs next time
  for (const k in _blockCheckCache) delete _blockCheckCache[k];

  const sellBtn = document.querySelector(".sell-btn");
  if (sellBtn) sellBtn.style.display = "";

  const rulingBar = document.getElementById("adminRulingBar");
  if (rulingBar) rulingBar.style.display = "none";

  document.getElementById("threadInput").value = "";
document.getElementById("threadImage").value = "";
chatMode = "dispute";
currentThreadId = null;
currentThreadListing = null;
const _resetTitle = document.getElementById("chatHeaderTitle");
if (_resetTitle) _resetTitle.textContent = "⚖️ Evidence & Admin Chat";
const _resetTick = document.getElementById("chatHeaderVerified");
if (_resetTick) _resetTick.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("threadModal");

  // If the Messages inbox was open underneath, bring it back
  if (_layerStack.some(function(l) { return l.id === "messagesModal"; })) {
    document.getElementById("messagesModal").classList.add("show");
  }
}

function renderThread() {
  const box = document.getElementById("threadMessages");
  box.innerHTML = "";
  let messages = [];
  let role = "buyer";
  let thread = null;   // ← declared here so both branches can share it

  if (chatMode === "dispute") {
    const order = allOrdersCache.find(function(o) { return o.ref === threadRef; });
    if (!order) return;
    messages = order.thread || [];
    role = threadRole;
    // thread stays null for dispute mode
  } else {
    const threads = loadThreads();
    thread = threads.find(function(t) { return t.id === currentThreadId; });
    if (!thread) return;
    messages = thread.messages || [];
    role = (thread.sellerId === currentUserId) ? "seller" : "buyer";
  }

  if (role === "seller") box.classList.add("view-as-seller");
else box.classList.remove("view-as-seller");

// Refresh the typing indicator (only shows in buyer↔seller chats)
if (chatMode === "bs" && thread) {
  renderTypingIndicator(thread);
} else {
  const ind = document.getElementById("threadTypingIndicator");
  if (ind) ind.style.display = "none";
}

if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "text-align:center;color:#999;font-size:13px;padding:20px;";
    empty.textContent = "No messages yet. Say hi! 👋";
    box.appendChild(empty);
  } else {
    messages.forEach(function(m, index) {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble " + (m.from || "buyer");
  if (m.deleted) bubble.classList.add("deleted");

  // Render the quoted message if this is a reply
  if (m.replyTo && !m.deleted) {
    const quote = document.createElement("div");
    quote.className = "bubble-quote";
    quote.setAttribute("onclick", "scrollToMessage(" + m.replyTo.messageIndex + ")");

    const quoteFrom = document.createElement("span");
quoteFrom.className = "bubble-quote-from";

const roleLabel = m.replyTo.from === "admin" ? "⚖️ admin"
                : m.replyTo.from === "seller" ? "🧑‍💼 seller"
                : "🛒 buyer";
quoteFrom.textContent = roleLabel;

    const quoteText = document.createElement("span");
    quoteText.className = "bubble-quote-text";
    if (m.replyTo.isDeleted) {
      quoteText.textContent = "This message was deleted";
    } else if (m.replyTo.isImage && !m.replyTo.text) {
      quoteText.textContent = "📷 Photo";
    } else {
      quoteText.textContent = m.replyTo.text || "";
    }

    quote.appendChild(quoteFrom);
    quote.appendChild(quoteText);
    bubble.appendChild(quote);
  }

  const textEl = document.createElement("div");
  textEl.className = "bubble-text";
  textEl.textContent = m.deleted ? "This message was deleted" : (m.text || "");
  bubble.appendChild(textEl);

      if (m.img && !m.deleted) {
        const pic = document.createElement("img");
        pic.src = m.img;
        pic.className = "bubble-img";
        bubble.appendChild(pic);
      }

      const meta = document.createElement("span");
meta.className = "bubble-meta";

// Which role am I in this chat?
const myRoleForTicks = (chatMode === "bs")
  ? ((thread && thread.sellerId === currentUserId) ? "seller" : "buyer")
  : null;

// Build the ticks HTML (empty string if not applicable)
const ticksHtml = (chatMode === "bs" && thread && myRoleForTicks)
  ? buildReadTicks(thread, myRoleForTicks, m)
  : "";

// Build the meta line: role · time · edited [tick]
const editedTag = m.editedAt ? " · edited" : "";
const baseMeta = (m.time || "") + editedTag;

// If we have ticks, append them right after the time
if (ticksHtml) {
  meta.innerHTML = baseMeta + " " + ticksHtml;
} else {
  meta.textContent = baseMeta;
}

bubble.appendChild(meta);

      const myRole = getMyRoleInChat();
const isMine = (m.from === myRole) && !m.deleted;
const isSystem = (m.from === "system");
// Don't allow editing/reply when the order is resolved (read-only chat)
let _chatIsResolved = false;
if (chatMode === "dispute" && threadRef) {
  const _o = allOrdersCache.find(function(o) { return o.ref === threadRef; });
  if (_o && (_o.status === "Funds released to seller" || _o.status === "refunded")) {
    _chatIsResolved = true;
  }
}
const canLongPress = !m.deleted && !isSystem && !_chatIsResolved;attachBubbleLongPress(bubble, index, canLongPress);

      box.appendChild(bubble);
    });
  }
  requestAnimationFrame(function() { box.scrollTop = box.scrollHeight; });
}

function sendThreadMessage() {
  const text = document.getElementById("threadInput").value.trim();
  const fileInput = document.getElementById("threadImage");
  const file = fileInput.files[0];

  function push(textFinal, imgFinal) {
    try {
      const now = Date.now();
      if (chatMode === "dispute") {
  const order = allOrdersCache.find(function(o) { return o.ref === threadRef; });
  if (!order) return;
  if (!order.thread) order.thread = [];
  const newMsg = { from: threadRole, text: textFinal, img: imgFinal, time: new Date().toLocaleString(), sentAt: now };
  if (replyingToMessageIndex !== null) {
    const original = order.thread[replyingToMessageIndex];
    if (original) {
      newMsg.replyTo = {
        messageIndex: replyingToMessageIndex,
        from: original.from,
        text: original.text || "",
        isImage: !!original.img,
        isDeleted: !!original.deleted
      };
    }
  }
  order.thread.push(newMsg);
        saveOrderToFirestore(order).catch(function(err) {
          console.warn("Failed to save message:", err);
        });
} else {
  const thread = allThreadsCache.find(function(t) { return t.id === currentThreadId; });
  if (!thread) return;
  const myRole = (thread.sellerId === currentUserId) ? "seller" : "buyer";
  const newMsg = { from: myRole, text: textFinal, img: imgFinal, time: new Date().toLocaleString(), sentAt: now };
  if (replyingToMessageIndex !== null) {
    const original = thread.messages[replyingToMessageIndex];
    if (original) {
      newMsg.replyTo = {
        messageIndex: replyingToMessageIndex,
        from: original.from,
        text: original.text || "",
        isImage: !!original.img,
        isDeleted: !!original.deleted
      };
    }
  }
  thread.messages.push(newMsg);
  thread.lastMessageAt = new Date().toLocaleString();
  thread.lastMessageAtMs = now;

  // Sending a message means I've read up to this point
// (use the message's sentAt, not Date.now(), for consistency)
if (!thread.lastReadBy) thread.lastReadBy = {};
thread.lastReadBy[myRole] = newMsg.sentAt || now;

  saveThreadToFirestore(thread).catch(function(err) {
    console.warn("Failed to save message:", err);
  });
}
    } catch (err) {
      alert("❌ Message too large — try a smaller image.");
      return;
    }
    document.getElementById("threadInput").value = "";
fileInput.value = "";
cancelReply();

    // Clear typing immediately — we just sent a message
    try { clearTypingSignal(); } catch (e) {}
    if (_typingStopTimer) { clearTimeout(_typingStopTimer); _typingStopTimer = null; }

renderThread();
  }

  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 600 / img.width, 600 / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        push(text, canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    push(text, null);
  }
}

// ============================================
// MESSAGE EDIT / DELETE
// ============================================
let bubblePressTimer = null;

function attachBubbleLongPress(bubbleEl, index, canPress) {
  function start() {
    if (!canPress) return;
    if (bubblePressTimer) clearTimeout(bubblePressTimer);
    bubblePressTimer = setTimeout(function() {
      bubblePressTimer = null;
      openMsgActionSheet(index);
    }, 500);
  }
  function cancel() {
    if (bubblePressTimer) {
      clearTimeout(bubblePressTimer);
      bubblePressTimer = null;
    }
  }
  bubbleEl.addEventListener("mousedown", start);
  bubbleEl.addEventListener("mouseup", cancel);
  bubbleEl.addEventListener("mouseleave", cancel);
  bubbleEl.addEventListener("touchstart", start, { passive: true });
  bubbleEl.addEventListener("touchend", cancel);
  bubbleEl.addEventListener("touchcancel", cancel);
  bubbleEl.addEventListener("touchmove", cancel);
}

function openMsgActionSheet(index) {
  activeMessageIndex = index;

  const messages = getCurrentMessages();
  const msg = messages[index];
  if (!msg) {
    closeMsgActionSheet();
    return;
  }

  const myRole = getMyRoleInChat();
  const isMine = (msg.from === myRole);

  const EDIT_WINDOW_MS = 5 * 60 * 1000;
  const canEdit = isMine
                  && !msg.deleted
                  && msg.sentAt
                  && (Date.now() - msg.sentAt) < EDIT_WINDOW_MS;

  const editBtn = document.getElementById("msgEditBtn");
  if (editBtn) {
    editBtn.style.display = canEdit ? "" : "none";
  }

  const deleteBtn = document.getElementById("msgDeleteBtn");
  if (deleteBtn) {
    deleteBtn.style.display = isMine ? "" : "none";
  }

  document.getElementById("msgActionSheet").classList.add("show");

  // Tell the layer manager we're open
  pushLayer("msgActionSheet", closeMsgActionSheet);
}

function closeMsgActionSheet() {
  activeMessageIndex = null;
  document.getElementById("msgActionSheet").classList.remove("show");

  // Tell the layer manager we're closed
  popLayer("msgActionSheet");
}

function getCurrentMessages() {
  if (chatMode === "dispute") {
    const order = allOrdersCache.find(function(o) { return o.ref === threadRef; });
    return order ? (order.thread || []) : [];
  } else {
    const threads = loadThreads();
    const thread = threads.find(function(t) { return t.id === currentThreadId; });
    return thread ? (thread.messages || []) : [];
  }
}

function saveCurrentMessages(messages) {
  if (chatMode === "dispute") {
    const order = allOrdersCache.find(function(o) { return o.ref === threadRef; });
    if (order) {
      order.thread = messages;
      saveOrderToFirestore(order).catch(function(err) {
        console.warn("Failed to save message to Firestore:", err);
      });
    }
  } else {
  const thread = allThreadsCache.find(function(t) { return t.id === currentThreadId; });
  if (thread) {
    thread.messages = messages;
    thread.lastMessageAt = new Date().toLocaleString();
thread.lastMessageAtMs = Date.now();
    saveThreadToFirestore(thread).catch(function(err) {
      console.warn("Failed to save messages:", err);
    });
  }
}
}

// ============================================
// CHAT TYPING INDICATOR — send side
// ============================================
// Writes typingBy / typingAt to the thread doc when the
// user is typing. Debounced so we don't spam Firestore.

let _typingDebounceTimer = null;    // throttle (writes at most every 2s)
let _typingStopTimer = null;        // clears the flag 2s after last keystroke
let _lastTypingWriteMs = 0;         // last time we wrote the "typing" flag

const TYPING_THROTTLE_MS = 2000;
const TYPING_CLEAR_AFTER_MS = 2000;

// Called whenever the user types into the chat input.
// Writes `typingBy` + `typingAt` at most once every 2 seconds.
function signalTyping() {
  // Only meaningful in buyer↔seller chats
  if (chatMode !== "bs") return;
  if (!currentThreadId) return;

  const thread = allThreadsCache.find(function (t) { return t.id === currentThreadId; });
  if (!thread) return;

  const myRole = (thread.sellerId === currentUserId) ? "seller" : "buyer";
  const now = Date.now();

  // Throttle the write
  if (now - _lastTypingWriteMs >= TYPING_THROTTLE_MS) {
    _lastTypingWriteMs = now;

    // Write to Firestore in the background. We update our local
    // cache too so re-renders don't fight the change.
    thread.typingBy = myRole;
    thread.typingAt = now;

    saveThreadToFirestore(thread).catch(function (err) {
      console.warn("Failed to write typing signal:", err);
    });
  }

  // Reset the "clear" timer — fires 2s after the last keystroke
  if (_typingStopTimer) clearTimeout(_typingStopTimer);
  _typingStopTimer = setTimeout(function () {
    _typingStopTimer = null;
    clearTypingSignal();
  }, TYPING_CLEAR_AFTER_MS);
}

// ============================================
// CHAT TYPING INDICATOR — receive side
// ============================================

// How long a typing signal is considered "fresh". If the last
// typingAt is older than this, we assume the other person stopped
// (or closed the app) and hide the indicator.
const TYPING_FRESH_MS = 5000;

// Renders (or hides) the typing indicator in the chat header.
// Called whenever the thread data updates or the chat opens.
function renderTypingIndicator(thread) {
  const el = document.getElementById("threadTypingIndicator");
  const textEl = el ? el.querySelector(".chat-typing-text") : null;
  if (!el || !textEl) return;

  // Only show in buyer↔seller chats
  if (chatMode !== "bs" || !thread) {
    el.style.display = "none";
    return;
  }

  const myRole = (thread.sellerId === currentUserId) ? "seller" : "buyer";
  const otherRole = (myRole === "buyer") ? "seller" : "buyer";

  // Is the other person signaling typing?
  const typingBy = thread.typingBy || null;
  const typingAt = thread.typingAt || 0;

  // Nothing to show if they're not typing, or if they're typing
  // as themselves (shouldn't happen, but be safe).
  if (typingBy !== otherRole) {
    el.style.display = "none";
    return;
  }

  // Freshness check
  if (Date.now() - typingAt > TYPING_FRESH_MS) {
    el.style.display = "none";
    return;
  }

  // Compose the name + text
  const otherId = (otherRole === "seller") ? thread.sellerId : thread.buyerId;
  let otherName = "...";

  if (otherId && _userNameCache[otherId]) {
    // Cached — use it immediately
    otherName = _userNameCache[otherId];
  } else if (otherId) {
    // Not cached — look it up in the background, then re-render
    getDisplayNameByUid(otherId).then(function (name) {
      if (!name) return;
      _userNameCache[otherId] = name;
      // Re-render if the same chat is still open
      if (chatMode === "bs" && currentThreadId) {
        const t = allThreadsCache.find(function (x) { return x.id === currentThreadId; });
        if (t) renderTypingIndicator(t);
      }
    }).catch(function () { /* silently fall back to "They" */ });
  }

  textEl.textContent = otherName + " is typing…";
  el.style.display = "flex";
}

// Clears the typing flag on the thread.
// Called when: user stops typing, sends a message, or closes the chat.
function clearTypingSignal() {
  if (chatMode !== "bs") return;
  if (!currentThreadId) return;

  const thread = allThreadsCache.find(function (t) { return t.id === currentThreadId; });
  if (!thread) return;

  // Nothing to clear
  if (!thread.typingBy && !thread.typingAt) return;

  thread.typingBy = null;
  thread.typingAt = null;
  _lastTypingWriteMs = 0;

  saveThreadToFirestore(thread).catch(function (err) {
    console.warn("Failed to clear typing signal:", err);
  });
}

// ============================================
// CHAT READ RECEIPTS — helpers
// ============================================

// Returns true if this message has been read by the other
// person in a buyer↔seller chat. Only meaningful for messages
// we sent.
//
// Logic: the other role's lastReadBy timestamp must be
// >= this message's sentAt.
function isMyMessageRead(thread, myRole, message) {
  if (!thread || !message) return false;
  if (!message.sentAt) return false;

  const otherRole = (myRole === "buyer") ? "seller" : "buyer";
  const otherReadAt = (thread.lastReadBy && thread.lastReadBy[otherRole]) || 0;

  return otherReadAt >= message.sentAt;
}

// Builds the tick element for a chat bubble.
// Returns an empty string if we shouldn't show ticks at all.
function buildReadTicks(thread, myRole, message) {
  // Only show ticks in buyer↔seller chats
  if (chatMode !== "bs") return "";

  // Only show ticks on our own messages
  if (message.from !== myRole) return "";

  // Deleted messages don't need ticks
  if (message.deleted) return "";

  const read = isMyMessageRead(thread, myRole, message);

  if (read) {
    // Double tick, green
    return '<span class="bubble-tick bubble-tick-read" aria-label="Read">✓✓</span>';
  }
  // Single tick, grey
  return '<span class="bubble-tick bubble-tick-sent" aria-label="Sent">✓</span>';
}

function getMyRoleInChat() {
  if (chatMode === "dispute") {
    // If admin is viewing the dispute, they act as "admin".
    // Otherwise, whichever role they opened the thread as (buyer or seller).
    return threadRole || "buyer";
  }
  const threads = loadThreads();
  const thread = threads.find(function(t) { return t.id === currentThreadId; });
  if (!thread) return "buyer";
  return (thread.sellerId === currentUserId) ? "seller" : "buyer";
}

function editActiveMessage() {
  if (activeMessageIndex === null) return;
  const messages = getCurrentMessages();
  const msg = messages[activeMessageIndex];
  if (!msg || msg.deleted) { closeMsgActionSheet(); return; }
  if (msg.from !== getMyRoleInChat()) { closeMsgActionSheet(); return; }

  const EDIT_WINDOW_MS = 5 * 60 * 1000;
  if (!msg.sentAt || (Date.now() - msg.sentAt) > EDIT_WINDOW_MS) {
    closeMsgActionSheet();
    alert("⏱️ This message is older than 5 minutes and can no longer be edited.\n\nYou can still delete it if needed.");
    return;
  }

  document.getElementById("threadInput").value = msg.text || "";
  document.getElementById("threadInput").focus();

  const sendBtn = document.querySelector(".chat-send");
  sendBtn.textContent = "Save ✓";
  sendBtn.setAttribute("onclick", "saveEditedMessage()");

  editingMessageIndex = activeMessageIndex;
  closeMsgActionSheet();
}

// ============================================
// MESSAGE REPLY
// ============================================

// Begin composing a reply to the active message
function startReply() {
  if (activeMessageIndex === null) return;
  const messages = getCurrentMessages();
  const msg = messages[activeMessageIndex];
  if (!msg) { closeMsgActionSheet(); return; }

  replyingToMessageIndex = activeMessageIndex;

  // Update the reply preview banner above the input
  const preview = document.getElementById("replyPreview");
  const label = document.getElementById("replyPreviewLabel");
  const text = document.getElementById("replyPreviewText");

  const roleLabel = msg.from === "admin" ? "⚖️ admin"
                  : msg.from === "seller" ? "🧑‍💼 seller"
                  : "🛒 buyer";

  label.textContent = "Replying to " + roleLabel;
  if (msg.deleted) {
    text.textContent = "This message was deleted";
  } else if (msg.img && !msg.text) {
    text.textContent = "📷 Photo";
  } else {
    text.textContent = msg.text || "";
  }

  preview.style.display = "flex";
  document.getElementById("threadInput").focus();
  closeMsgActionSheet();
}

// Cancel the current reply
function cancelReply() {
  replyingToMessageIndex = null;
  const preview = document.getElementById("replyPreview");
  if (preview) preview.style.display = "none";
}

// Scroll to a quoted message and flash it
function scrollToMessage(index) {
  const box = document.getElementById("threadMessages");
  if (!box) return;
  const bubbles = box.querySelectorAll(".chat-bubble");
  const target = bubbles[index];
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });

  // Flash the bubble
  target.classList.add("highlight-flash");
  setTimeout(function() {
    target.classList.remove("highlight-flash");
  }, 1600);
}

function saveEditedMessage() {
  if (editingMessageIndex === null) return;
  const newText = document.getElementById("threadInput").value.trim();
  if (!newText) {
    alert("Message can't be empty. Tap Cancel or type something.");
    return;
  }
  const messages = getCurrentMessages();
  const msg = messages[editingMessageIndex];
  if (!msg) { cancelEditMode(); return; }

  msg.text = newText;
  msg.editedAt = new Date().toLocaleString();
  saveCurrentMessages(messages);

  cancelEditMode();
  renderThread();
}

function cancelEditMode() {
  editingMessageIndex = null;
  const input = document.getElementById("threadInput");
  if (input) input.value = "";
  const sendBtn = document.querySelector(".chat-send");
  if (sendBtn) {
    sendBtn.textContent = "Send ▸";
    sendBtn.setAttribute("onclick", "sendThreadMessage()");
  }
}

function deleteActiveMessage() {
  if (activeMessageIndex === null) return;
  const messages = getCurrentMessages();
  const msg = messages[activeMessageIndex];
  if (!msg) { closeMsgActionSheet(); return; }
  if (msg.from !== getMyRoleInChat()) { closeMsgActionSheet(); return; }

  if (!confirm("Delete this message? The other person will see 'This message was deleted'.")) {
    closeMsgActionSheet();
    return;
  }

  msg.deleted = true;
  msg.text = "";
  msg.img = null;
  saveCurrentMessages(messages);

  closeMsgActionSheet();
  renderThread();
}

// ============================================
// THREAD — Delete conversation (for me only)
// ============================================
function openThreadActionSheet(thread) {
  activeThreadForDelete = thread;
  document.getElementById("threadActionSheet").classList.add("show");

  // Tell the layer manager we're open
  pushLayer("threadActionSheet", closeThreadActionSheet);
}

function closeThreadActionSheet() {
  activeThreadForDelete = null;
  document.getElementById("threadActionSheet").classList.remove("show");

  // Tell the layer manager we're closed
  popLayer("threadActionSheet");
}

async function deleteActiveThread() {
  if (!activeThreadForDelete) return;
  if (!confirm("Delete this conversation from your inbox?\n\nThe other person will still see it.")) {
    closeThreadActionSheet();
    return;
  }

  const targetId = activeThreadForDelete.id;
  const thread = allThreadsCache.find(function(t) { return t.id === targetId; });
  if (!thread) { closeThreadActionSheet(); return; }

  if (!thread.deletedFor) thread.deletedFor = [];
  if (!thread.deletedFor.includes(currentUserId)) {
    thread.deletedFor.push(currentUserId);
  }

  try {
    await saveThreadToFirestore(thread);
    closeThreadActionSheet();
    openMessages();
  } catch (err) {
    alert("❌ Failed to delete conversation: " + err.message);
  }
}

// ============================================
// MESSAGES PAGE
// ============================================
let _myMessagesTab = "all";

async function openMessages() {
  // NOTE: we don't call loadThreadsFromFirestore() here.
  // The subscribeToThreads() listener is already keeping
  // allThreadsCache fresh. A separate getDocs call would
  // race with the subscription and overwrite fresh data
  // with stale data.
  //
  // But if the cache is empty (e.g. the inbox was opened
  // before the subscription finished warming up), do a
  // one-time fetch.
  if (allThreadsCache.length === 0) {
    await loadThreadsFromFirestore();
  }

  const page = document.getElementById("messagesModal");
  if (!page) return;

  // Reset to "All" tab each time
  _myMessagesTab = "all";
  document.querySelectorAll(".messages-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === "all");
  });

  renderMyMessages();

page.style.display = "flex";

// Highlight the "Messages" tab in the bottom nav
document.querySelectorAll(".bottom-nav-item").forEach(function(el) {
  el.classList.toggle("active", el.getAttribute("data-tab") === "messages");
});

// Tell the layer manager we're open
pushLayer("messagesModal", closeMessages);
}

function closeMessages() {
  const page = document.getElementById("messagesModal");
  if (page) page.style.display = "none";

  // Reset the bottom nav highlight to Home
  document.querySelectorAll(".bottom-nav-item").forEach(function(el) {
    el.classList.toggle("active", el.getAttribute("data-tab") === "home");
  });

  // Tell the layer manager we're closed
  popLayer("messagesModal");
}

// Tab switching
function filterMyMessages(tab) {
  _myMessagesTab = tab;
  document.querySelectorAll(".messages-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  renderMyMessages();
}

// Render the messages list for the current tab
function renderMyMessages() {
  const listDiv = document.getElementById("messagesList");
  const empty = document.getElementById("noMessages");
  const emptyTitle = document.getElementById("messagesEmptyTitle");
  const emptyText = document.getElementById("messagesEmptyText");
  if (!listDiv || !empty) return;

  // Get my threads, filter by tab
  let threads = getMyThreads();

  if (_myMessagesTab === "buying") {
    threads = threads.filter(function (t) { return t.buyerId === currentUserId; });
  } else if (_myMessagesTab === "selling") {
    threads = threads.filter(function (t) { return t.sellerId === currentUserId; });
  }

  // Sort newest first
  threads.sort(function (a, b) {
    const aT = a.lastMessageAtMs || (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0) || 0;
    const bT = b.lastMessageAtMs || (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0) || 0;
    return bT - aT;
  });

  listDiv.innerHTML = "";

  if (threads.length === 0) {
    empty.style.display = "block";
    if (_myMessagesTab === "buying") {
      if (emptyTitle) emptyTitle.textContent = "No buying chats yet";
      if (emptyText) emptyText.textContent = "Chat with a seller from any listing and it'll appear here.";
    } else if (_myMessagesTab === "selling") {
      if (emptyTitle) emptyTitle.textContent = "No selling chats yet";
      if (emptyText) emptyText.textContent = "When a buyer messages you about a listing, it'll appear here.";
    } else {
      if (emptyTitle) emptyTitle.textContent = "No messages yet";
      if (emptyText) emptyText.textContent = "Chat with a seller from any listing — your conversations will appear here.";
    }
    return;
  }

  empty.style.display = "none";

  threads.forEach(function (t) {
    listDiv.appendChild(createMessageRow(t));
  });
}

// Build a single conversation row
function createMessageRow(t) {
  const listing = allListingsCache.find(function (l) { return l.id === t.listingId; });
  const listingName = listing ? formatTitle(listing.name) : "(deleted listing)";
  const iAmSeller = (t.sellerId === currentUserId);

  // Who's the other person in this chat?
  const otherId = iAmSeller ? t.buyerId : t.sellerId;

  const msgs = t.messages || [];
  const last = msgs[msgs.length - 1];
  let preview = "No messages yet";
  if (last) {
    if (last.deleted) preview = "This message was deleted";
    else if (last.text) preview = last.text;
    else if (last.img) preview = "📷 Photo";
  }
  const previewShort = preview.length > 40 ? preview.slice(0, 40) + "…" : preview;

  const row = document.createElement("div");
  row.className = "message-row" + (isThreadUnread(t) ? " unread" : "");
  row.onclick = function () { openBuyerSellerThread(t); };

  // Long-press to delete
  let rowPressTimer = null;
  function startRowPress() {
    if (rowPressTimer) clearTimeout(rowPressTimer);
    rowPressTimer = setTimeout(function () {
      rowPressTimer = null;
      openThreadActionSheet(t);
    }, 500);
  }
  function cancelRowPress() {
    if (rowPressTimer) { clearTimeout(rowPressTimer); rowPressTimer = null; }
  }
  row.addEventListener("mousedown", startRowPress);
  row.addEventListener("mouseup", cancelRowPress);
  row.addEventListener("mouseleave", cancelRowPress);
  row.addEventListener("touchstart", startRowPress, { passive: true });
  row.addEventListener("touchend", cancelRowPress);
  row.addEventListener("touchcancel", cancelRowPress);
  row.addEventListener("touchmove", cancelRowPress);

const iBlockedThem = otherId && isUserBlocked(otherId);

  row.innerHTML =
    '<div class="message-row-top">' +
      '<span class="message-row-name">' + escapeHtml(listingName) + (iBlockedThem ? ' <span style="background:#d9534f;color:white;font-size:9px;font-weight:bold;padding:1px 6px;border-radius:6px;letter-spacing:0.3px;vertical-align:middle;">BLOCKED</span>' : '') + '</span>' +
      '<span class="message-row-time">' + escapeHtml(t.lastMessageAt || "") + '</span>' +
    '</div>' +
    '<div class="message-row-meta" id="msg-meta-' + t.id + '"></div>' +
    '<div class="message-row-preview">' + escapeHtml(previewShort) + '</div>';

  // Fill the meta line with the other person's name — async,
  // so we do it after the row is built. Falls back to a
  // placeholder while we look up the name.
  const metaEl = row.querySelector("#msg-meta-" + t.id);
  if (metaEl && otherId) {
    // Immediate placeholder so the row doesn't jump
    metaEl.textContent = "…";

    if (_userNameCache[otherId]) {
      metaEl.textContent = _userNameCache[otherId];
    } else {
      getDisplayNameByUid(otherId).then(function (name) {
        // Only update if this row is still in the DOM (inbox not re-rendered)
        const el = document.getElementById("msg-meta-" + t.id);
        if (el) el.textContent = name || "Member";
      }).catch(function () {
        const el = document.getElementById("msg-meta-" + t.id);
        if (el) el.textContent = "Member";
      });
    }
  }

  return row;
}

// ============================================
// CHAT HEADER — verified tick
// ============================================

// Updates the small ✓ tick in the chat header based on
// whether the OTHER person in the chat is verified.
async function updateChatHeaderVerified(otherUid) {
  const tick = document.getElementById("chatHeaderVerified");
  if (!tick) return;

  // Hide immediately (in case the previous chat had it shown)
  tick.style.display = "none";

  if (!otherUid) return;

  try {
    const verified = await isSellerVerified(otherUid);
    if (!verified) return;

    // Double-check we're still in the same chat
    if (chatMode !== "bs" || !currentThreadId) return;

    tick.style.display = "inline-flex";
  } catch (err) {
    console.warn("updateChatHeaderVerified failed:", err);
  }
}

// ============================================
// CHAT BLOCK CHECK
// ============================================
// Determines the block relationship between me and another user:
//   "me"   — I've blocked them
//   "them" — they've blocked me
//   "none" — no block either way
//
// Cached per uid for the current session so we don't hit
// Firestore on every render.

const _blockCheckCache = {};

async function checkBlockBetweenMeAnd(otherUid) {
  if (!otherUid) return "none";
  if (otherUid === currentUserId) return "none";

  // If they're in my own block list, we know already
  if (isUserBlocked(otherUid)) return "me";

  // Cached answer?
  if (_blockCheckCache[otherUid]) return _blockCheckCache[otherUid];

  // Otherwise check their doc
  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", otherUid));
    if (snap.exists()) {
      const data = snap.data();
      const list = Array.isArray(data.blockedUsers) ? data.blockedUsers : [];
      if (list.indexOf(currentUserId) !== -1) {
        _blockCheckCache[otherUid] = "them";
        return "them";
      }
    }
  } catch (err) {
    console.warn("checkBlockBetweenMeAnd failed:", err);
  }

  _blockCheckCache[otherUid] = "none";
  return "none";
}


async function openBuyerSellerThread(thread) {
  // Hide the inbox visually but KEEP it in the layer stack.
  // That way, when the chat closes and the back button is
  // pressed, we return to the inbox instead of the homepage.
  document.getElementById("messagesModal").classList.remove("show");

  chatMode = "bs";
  currentThreadId = thread.id;

  // Save this chat as the last location so a refresh can restore it.
  saveLastLocation("threadModal", {
    mode: "bs",
    threadId: thread.id
  });

  subscribeToThread(thread.id);
  const listing = allListingsCache.find(function(l) { return l.id === thread.listingId; });

  // Block check — decide whether this chat is read-only
  const otherUid = (thread.sellerId === currentUserId) ? thread.buyerId : thread.sellerId;
  const blockStatus = await checkBlockBetweenMeAnd(otherUid);

  const _chatFooter = document.querySelector(".chat-footer");
  const _closedNotice = document.getElementById("closedChatNotice");

  if (blockStatus === "me") {
    if (_chatFooter) _chatFooter.style.display = "none";
    if (_closedNotice) {
      _closedNotice.style.display = "block";
      _closedNotice.innerHTML = "🚫 <strong>You've blocked this user.</strong> Unblock from Settings → Blocked users to message again.";
    }
  } else if (blockStatus === "them") {
    if (_chatFooter) _chatFooter.style.display = "none";
    if (_closedNotice) {
      _closedNotice.style.display = "block";
      _closedNotice.innerHTML = "🔒 <strong>This user isn't accepting messages right now.</strong> You can still read the conversation history.";
    }
  } else {
    if (_chatFooter) _chatFooter.style.display = "flex";
    if (_closedNotice) _closedNotice.style.display = "none";
  }

// Mark thread as read by me — up to the newest message
// (not Date.now(), to avoid clock-skew between devices)
if (!thread.lastReadBy) thread.lastReadBy = {};
const myRoleInThread = (thread.sellerId === currentUserId) ? "seller" : "buyer";
const newestAt = thread.lastMessageAtMs
  || (thread.lastMessageAt ? new Date(thread.lastMessageAt).getTime() : 0)
  || Date.now();
thread.lastReadBy[myRoleInThread] = newestAt;
saveThreadToFirestore(thread).catch(function(err) { console.warn(err); });
updateMessagesBadge();
  currentThreadListing = listing || { name: "(listing)" };
const _headerTitle = document.getElementById("chatHeaderTitle");
if (_headerTitle) {
  _headerTitle.textContent = "💬 " + (listing ? formatTitle(listing.name) : "Chat");
}

// Check if the OTHER person in this thread is verified
const _otherUid = (thread.sellerId === currentUserId) ? thread.buyerId : thread.sellerId;
updateChatHeaderVerified(_otherUid);
  renderThread();
  document.getElementById("threadModal").style.display = "flex";
  document.body.classList.add("chat-open");
  const sellBtn = document.querySelector(".sell-btn");
  if (sellBtn) sellBtn.style.display = "none";
  document.getElementById("threadInput").value = "";
  document.getElementById("threadImage").value = "";

  // Tell the layer manager we're open
  pushLayer("threadModal", closeThread);

  setTimeout(function() {
    const box = document.getElementById("threadMessages");
    if (box) box.scrollTop = box.scrollHeight;
  }, 50);
}

// ============================================
// CHAT — "Message Seller" button
// ============================================
async function chatSeller() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;
  if (item.sellerId === currentUserId) {
    alert("💬 This is your own listing.");
    return;
  }
  if (!item.sellerId) {
    alert("💬 This seller isn't available for messaging.");
    return;
  }
  const thread = await getOrCreateThread(item.id, currentUserId, item.sellerId);
  chatMode = "bs";
  currentThreadId = thread.id;
  subscribeToThread(thread.id);
  // Detail modal stays open underneath — the chat is full-screen
// and covers it. When the chat closes, detail is already there.
  document.body.classList.add("chat-open");
  const sellBtn = document.querySelector(".sell-btn");
  if (sellBtn) sellBtn.style.display = "none";
  const _headerTitle2 = document.getElementById("chatHeaderTitle");
if (_headerTitle2) {
  _headerTitle2.textContent = "💬 " + formatTitle(item.name);
}

// Check if the seller is verified
updateChatHeaderVerified(item.sellerId);
  renderThread();
  document.getElementById("threadModal").style.display = "flex";
  document.getElementById("threadInput").value = "";
  document.getElementById("threadImage").value = "";

  // Tell the layer manager we're open
  pushLayer("threadModal", closeThread);

  setTimeout(function() {
    const box = document.getElementById("threadMessages");
    if (box) box.scrollTop = box.scrollHeight;
  }, 50);
}

// ============================================
// BOOTSTRAP
// ============================================
// Wait for Firebase to be ready, then start auth.
window.addEventListener("firebase-ready", function() {
  initAuth();
});

// Safety: if Firebase never signals within 10 seconds,
// show a message instead of rendering wrong cards.
setTimeout(function() {
  const listingsDiv = document.querySelector(".listings");
  if (listingsDiv && listingsDiv.children.length === 0) {
    console.warn("Firebase didn't signal in time.");
    listingsDiv.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;color:#999;padding:20px;">' +
      'Connection issue — please refresh the page.' +
      '</p>';
  }
}, 10000);
async function adminRuleFromChat(ruling) {
  if (threadRole !== "admin") return;
  const order = allOrdersCache.find(function(o) { return o.ref === threadRef; });
  if (!order) {
    alert("Order not found.");
    return;
  }
  if (!confirm("Are you sure? This ruling is final and will close the dispute.")) return;

  order.status = (ruling === "refund") ? "refunded" : "Funds released to seller";
  order.ruledBy = "admin";
  if (!order.thread) order.thread = [];
  order.thread.push({
    from: "admin",
    text: (ruling === "refund")
      ? "⚖️ FINAL RULING: Refund approved. The buyer will be refunded from escrow."
      : "⚖️ FINAL RULING: Funds released to the seller. Case closed.",
    time: new Date().toLocaleString(),
    sentAt: Date.now()
  });

  try {
    await saveOrderToFirestore(order);
    // Adjust listing stock based on ruling
if (ruling === "refund") {
  await restoreListingQuantity(order);
} else {
  await decrementListingQuantity(order);
}
    await loadOrdersFromFirestore();
    renderThread();
    alert("✅ Ruling saved. The dispute is now closed.");
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}

// ============================================
// ORDER NOTIFICATIONS — helpers
// ============================================
// Fires notifications when order events happen.
// Uses sendAppNotification() — so toasts when visible,
// system notifications when hidden.

// Notify the SELLER that a new order has arrived.
function notifySellerNewOrder(order) {
  if (!order) return;
  const item = getOrderDisplayName(order) || "an item";
  const total = Number(order.total) || 0;
  sendAppNotification(
    "🛒 New order received",
    item + " · GH₵ " + total.toLocaleString(),
    "order-" + order.ref
  );
}

// Notify the BUYER that their order was marked as shipped.
function notifyBuyerShipped(order) {
  if (!order) return;
  const item = getOrderDisplayName(order) || "your item";
  sendAppNotification(
    "📦 Your order shipped",
    item + " · " + (order.ref || ""),
    "order-" + order.ref
  );
}

// Notify the SELLER that the buyer confirmed delivery.
function notifySellerConfirmed(order) {
  if (!order) return;
  const item = getOrderDisplayName(order) || "an item";
  const total = Number(order.total) || 0;
  sendAppNotification(
    "✅ Delivery confirmed",
    item + " · GH₵ " + total.toLocaleString() + " released",
    "order-" + order.ref
  );
}

// Notify the BUYER that the seller refunded the order.
function notifyBuyerRefunded(order) {
  if (!order) return;
  const item = getOrderDisplayName(order) || "your item";
  sendAppNotification(
    "💸 Refund issued",
    item + " · " + (order.ref || ""),
    "order-" + order.ref
  );
}

// Notify whoever's on the OTHER side of a dispute + the admin.
// Called when a dispute is opened. We notify the "other" party
// — if a buyer opened it, notify the seller; and vice versa.
// The admin sees it via the moderation panel anyway.
function notifyDisputeOpened(order, openerRole) {
  if (!order) return;
  const item = getOrderDisplayName(order) || "an order";
  // Only fires on the "other party" side — so if it was the buyer
  // who opened it, the seller sees this; if the seller opened it,
  // the buyer sees this.
  sendAppNotification(
    "⚖️ Dispute opened",
    item + " · " + (order.ref || ""),
    "dispute-" + order.ref
  );
}

// ============================================
// AUTO-TIMEOUT — Lazy check on every app open
// ============================================
async function runAutoTimeoutCheck() {
  if (!currentAuthUser) return;

  // Reload orders to get the freshest state
  await loadOrdersFromFirestore().catch(function(e) { console.warn(e); });

  const now = Date.now();
  let actedCount = 0;

  for (const order of allOrdersCache) {
    let changed = false;

    // ---- Case 1: Ship window expired, seller never shipped ----
    if (
      order.status === "Paid — funds held in escrow" &&
      order.shipDeadline &&
      order.shipDeadline < now
    ) {
      order.status = "refunded";
      order.autoRefundedAt = new Date().toLocaleString();
      order.autoRefundReason = "Seller did not ship within 5 days.";
      if (!order.thread) order.thread = [];
      order.thread.push({
        from: "system",
        text: "⏰ Auto-timeout: Seller did not ship within 5 days. Funds have been returned to the buyer.",
        time: new Date().toLocaleString(),
        sentAt: now
      });
      changed = true;
    }

// ---- Case 2: Confirm window expired, buyer never confirmed ----
if (
  order.status === "Shipped — on the way" &&
  order.confirmDeadline &&
  order.confirmDeadline < now
) {
  order.status = "Funds released to seller";
order.autoReleasedAt = new Date().toLocaleString();
order.releasedAt = now;                // ← record release time
  order.autoReleaseReason = "Buyer did not confirm within 7 days.";
  if (!order.thread) order.thread = [];
  order.thread.push({
    from: "system",
    text: "⏰ Auto-timeout: Buyer did not confirm within 7 days. Funds have been released to the seller.",
    time: new Date().toLocaleString(),
    sentAt: now
  });
  // Also mark the listing as sold
  await decrementListingQuantity(order);
  changed = true;
}

    if (changed) {
      try {
        await saveOrderToFirestore(order);
        actedCount++;
      } catch (err) {
        console.warn("Failed to save auto-timeout order:", err);
      }
    }
  }

  if (actedCount > 0) {
    console.log("Auto-timeout acted on " + actedCount + " order(s).");
    // Refresh caches so the UI shows the new state
    await loadOrdersFromFirestore().catch(function(e) { console.warn(e); });
  }
}

// ============================================
// EXTENSIONS — one-time deadline extensions
// ============================================
async function extendShipDeadline(ref) {
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) { alert("Order not found."); return; }
  if (order.status !== "Paid — funds held in escrow") {
    alert("This order can't be extended right now.");
    return;
  }
  if (order.extensions && order.extensions.seller >= 1) {
    alert("You've already used your extension for this order.");
    return;
  }
  if (!confirm("Extend the ship deadline by 2 days? You can only do this once.")) return;

  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  order.shipDeadline = (order.shipDeadline || Date.now()) + TWO_DAYS_MS;
  if (!order.extensions) order.extensions = { buyer: 0, seller: 0 };
  order.extensions.seller = (order.extensions.seller || 0) + 1;

  if (!order.thread) order.thread = [];
  order.thread.push({
    from: "system",
    text: "🧑‍💼 Seller extended the ship deadline by 2 days.",
    time: new Date().toLocaleString(),
    sentAt: Date.now()
  });

  try {
    await saveOrderToFirestore(order);
    await loadOrdersFromFirestore();
    openShop();
    alert("✅ Ship deadline extended by 2 days.");
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}

async function extendConfirmDeadline(ref) {
  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
  if (!order) { alert("Order not found."); return; }
  if (order.status !== "Shipped — on the way") {
    alert("This order can't be extended right now.");
    return;
  }
  if (order.extensions && order.extensions.buyer >= 1) {
    alert("You've already used your extension for this order.");
    return;
  }
  if (!confirm("Extend the confirm deadline by 3 days? You can only do this once.")) return;

  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  order.confirmDeadline = (order.confirmDeadline || Date.now()) + THREE_DAYS_MS;
  if (!order.extensions) order.extensions = { buyer: 0, seller: 0 };
  order.extensions.buyer = (order.extensions.buyer || 0) + 1;

  if (!order.thread) order.thread = [];
  order.thread.push({
    from: "system",
    text: "🛒 Buyer extended the confirm deadline by 3 days.",
    time: new Date().toLocaleString(),
    sentAt: Date.now()
  });

  try {
    await saveOrderToFirestore(order);
    await loadOrdersFromFirestore();
    openOrders();
    alert("✅ Confirm deadline extended by 3 days.");
  } catch (err) {
    alert("❌ Failed: " + err.message);
  }
}
// Safely get a nicely formatted name for an order's item.
// Falls back to raw name if the listing is gone.
function getOrderDisplayName(order) {
  if (!order) return "";
  const listing = allListingsCache.find(function(l) { return l.id === order.itemId; });
  if (listing && listing.name) return formatTitle(listing.name);
  return formatTitle(order.itemName || "");
}
// ============================================
// UNREAD MESSAGES
// ============================================

function isThreadUnread(thread) {
  if (!thread || !thread.messages || thread.messages.length === 0) return false;
  const myRole = (thread.sellerId === currentUserId) ? "seller" : "buyer";
  const lastRead = (thread.lastReadBy && thread.lastReadBy[myRole]) || 0;
  const lastMs = thread.lastMessageAtMs
    || (thread.lastMessageAt ? new Date(thread.lastMessageAt).getTime() : 0)
    || 0;
  return lastMs > lastRead;
}

function updateMessagesBadge() {
  const badge = document.getElementById("messagesBadge");
  if (!badge) return;
  const myThreads = getMyThreads();
  const unreadCount = myThreads.filter(isThreadUnread).length;
  if (unreadCount > 0) {
    badge.textContent = String(unreadCount);
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
  // Also update the bottom-nav badge
if (typeof updateBottomNavBadge === "function") updateBottomNavBadge();
}

// ============================================
// REPORTS — reason lists + state
// ============================================

// Reasons for reporting a LISTING
const REPORT_LISTING_REASONS = [
  "Item doesn't match the description",
  "Suspected scam or fraud",
  "Prohibited or illegal item",
  "Duplicate or spam listing",
  "Offensive content or photos",
  "Wrong category or misleading info",
  "Other"
];

// Reasons for reporting a USER
const REPORT_USER_REASONS = [
  "Suspected scam or fraud",
  "Rude or abusive behaviour",
  "Not delivering items after payment",
  "Impersonation or fake account",
  "Selling prohibited or illegal items",
  "Spamming or harassment",
  "Other"
];

// Current report session state
let _reportContext = {
  type: null,          // "listing" or "user"
  targetId: null,      // listing id or user uid
  targetName: "",      // for display
  reason: null         // selected reason string
};


// ============================================
// RATINGS & REVIEWS
// ============================================

let _reviewContext = { ref: null, role: null, stars: 0 };

// ============================================
// REPORTS — modal open/close + reason picker
// ============================================

// Opens the report modal.
// type: "listing" or "user"
// targetId: the listing id or the user's uid
// targetName: what to show in the subtitle (listing title or username)
function openReportModal(type, targetId, targetName) {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);

  // Require login
  if (!user) {
    openAuthFromHeader();
    return;
  }

  // Can't report your own listing / yourself
  if (type === "user" && targetId === currentUserId) {
    marketaToast("You can't report yourself 😄");
    return;
  }
  if (type === "listing") {
    const listing = allListingsCache.find(function (l) { return l.id === targetId; });
    if (listing && listing.sellerId === currentUserId) {
      marketaToast("You can't report your own listing");
      return;
    }
  }

  // Save context
  _reportContext.type = type;
  _reportContext.targetId = targetId;
  _reportContext.targetName = targetName || "";
  _reportContext.reason = null;

  // Set the title
  const titleEl = document.getElementById("reportModalTitle");
  if (titleEl) {
    titleEl.textContent = type === "listing"
      ? "🚩 Report this listing"
      : "🚩 Report this user";
  }

  // Set the subtitle
  const subEl = document.getElementById("reportModalSubtitle");
  if (subEl) {
    if (type === "listing") {
      subEl.textContent = "Reporting: " + (targetName || "this listing");
    } else {
      subEl.textContent = "Reporting: " + (targetName || "this user");
    }
  }

  // Populate the reasons
  const reasonsEl = document.getElementById("reportReasons");
  if (reasonsEl) {
    reasonsEl.innerHTML = "";
    const reasons = (type === "listing") ? REPORT_LISTING_REASONS : REPORT_USER_REASONS;

    reasons.forEach(function (text) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "report-reason";
      btn.setAttribute("data-reason", text);
      btn.innerHTML =
        '<span class="report-reason-radio"></span>' +
        '<span class="report-reason-label">' + escapeHtml(text) + '</span>';
      btn.addEventListener("click", function () {
        pickReportReason(text);
      });
      reasonsEl.appendChild(btn);
    });
  }

  // Reset details + counter + error
  const detailsEl = document.getElementById("reportDetails");
  const counterEl = document.getElementById("reportDetailsCounter");
  const errEl = document.getElementById("reportError");
  if (detailsEl) detailsEl.value = "";
  if (counterEl) counterEl.textContent = "0/500";
  if (errEl) errEl.style.display = "none";

  // Wire up the live character counter (once)
  if (detailsEl && !detailsEl.dataset.counterWired) {
    detailsEl.dataset.counterWired = "yes";
    detailsEl.addEventListener("input", function () {
      const c = document.getElementById("reportDetailsCounter");
      if (c) c.textContent = detailsEl.value.length + "/500";
    });
  }

  // Show the modal
  const modal = document.getElementById("reportModal");
  if (modal) modal.style.display = "flex";

  // Tell the layer manager
  pushLayer("reportModal", closeReportModal);
}

// Closes the report modal.
function closeReportModal() {
  const modal = document.getElementById("reportModal");
  if (modal) modal.style.display = "none";

  // Clear state
  _reportContext = { type: null, targetId: null, targetName: "", reason: null };

  // Tell the layer manager
  popLayer("reportModal");
}

// Highlights the picked reason tile.
function pickReportReason(reason) {
  _reportContext.reason = reason;

  const tiles = document.querySelectorAll("#reportReasons .report-reason");
  tiles.forEach(function (tile) {
    const isThis = tile.getAttribute("data-reason") === reason;
    tile.classList.toggle("selected", isThis);
  });
}

// Submits the report to Firestore.
async function submitReport() {
  // Validate: reason must be selected
  if (!_reportContext.reason) {
    marketaAlert("Pick a reason", "Please choose what's wrong before submitting. 🙏");
    return;
  }

  // Validate: type must be set
  if (!_reportContext.type || !_reportContext.targetId) {
    marketaAlert("Something went wrong", "Please close and try again.");
    return;
  }

  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) {
    openAuthFromHeader();
    return;
  }

  // Read details
  const detailsEl = document.getElementById("reportDetails");
  const details = detailsEl ? detailsEl.value.trim() : "";

  // Build the report object
  const report = {
    type: _reportContext.type,              // "listing" or "user"
    targetId: _reportContext.targetId,
    targetName: _reportContext.targetName || "",
    reason: _reportContext.reason,
    details: details,
    reportedBy: currentUserId,
    reportedByName: user.displayName || (user.email ? user.email.split("@")[0] : "User"),
    status: "open",                          // "open" | "dismissed" | "actioned"
    createdAt: Date.now(),
    createdAtStr: new Date().toLocaleString()
  };

  // Disable the submit button while saving
  const btns = document.querySelectorAll("#reportModal .buy-btn");
  const submitBtn = btns[btns.length - 1];
  const originalText = submitBtn ? submitBtn.innerHTML : "";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
  }

  try {
    const { db, collection, addDoc } = await getFsModules();
    await addDoc(collection(db, "reports"), report);

// Clear the reports cache so the next open of Moderation
// → Reports shows the new report fresh.
_modReportsCache = [];
_modReportsLoaded = false;

// If the moderation panel is currently open, refresh the Reports tab
const moderationOpen = document.getElementById("moderationPage").style.display === "flex";
if (moderationOpen && _moderationTab === "reports") {
  renderModerationTab();
}

// Close the modal
closeReportModal();

// Show confirmation
marketaToast("Report submitted ✅ Thank you");

  } catch (err) {
    console.warn("Report submit failed:", err);
    marketaAlert("❌ Error", "Couldn't submit the report: " + err.message);

    // Restore the button
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
}

function openReviewModal(orderRef, role) {
  const order = allOrdersCache.find(function(o) { return o.ref === orderRef; });
  if (!order) { alert("Order not found."); return; }

// ============================================
// REPORTS — reason lists + state
// ============================================

// Reasons for reporting a LISTING
const REPORT_LISTING_REASONS = [
  "Item doesn't match the description",
  "Suspected scam or fraud",
  "Prohibited or illegal item",
  "Duplicate or spam listing",
  "Offensive content or photos",
  "Wrong category or misleading info",
  "Other"
];

// Reasons for reporting a USER
const REPORT_USER_REASONS = [
  "Suspected scam or fraud",
  "Rude or abusive behaviour",
  "Not delivering items after payment",
  "Impersonation or fake account",
  "Selling prohibited or illegal items",
  "Spamming or harassment",
  "Other"
];

// Current report session state
let _reportContext = {
  type: null,          // "listing" or "user"
  targetId: null,      // listing id or user uid
  targetName: "",      // for display
  reason: null         // selected reason string
};

  _reviewContext.ref = orderRef;
  _reviewContext.role = role;
  _reviewContext.stars = 0;

  document.getElementById("reviewModalTitle").textContent =
    role === "seller" ? "⭐ Rate this Seller" : "⭐ Rate this Buyer";
  document.getElementById("reviewModalSubtitle").textContent =
    (role === "seller" ? "Seller" : "Buyer") + " of: " + getOrderDisplayName(order);

  // Reset stars
  document.querySelectorAll(".star-btn").forEach(function(btn) {
    btn.classList.remove("active");
  });
  document.getElementById("starLabel").textContent = "Tap a star";
  document.getElementById("reviewText").value = "";

  document.getElementById("reviewModal").style.display = "flex";

  // Tell the layer manager we're open
  pushLayer("reviewModal", closeReviewModal);
}

function closeReviewModal() {
  document.getElementById("reviewModal").style.display = "none";
  _reviewContext = { ref: null, role: null, stars: 0 };

  // Tell the layer manager we're closed
  popLayer("reviewModal");
}

function pickStars(n) {
  _reviewContext.stars = n;
  document.querySelectorAll(".star-btn").forEach(function(btn) {
    const s = Number(btn.getAttribute("data-stars"));
    if (s <= n) btn.classList.add("active");
    else btn.classList.remove("active");
  });
  const labels = ["", "Terrible", "Bad", "OK", "Good", "Excellent!"];
  document.getElementById("starLabel").textContent = labels[n] || "";
}

async function submitReview() {
  const { ref, role, stars } = _reviewContext;
  if (!ref || !role) { closeReviewModal(); return; }
  if (stars < 1 || stars > 5) {
  marketaAlert("Pick a rating", "Please pick a star rating first.");
  return;
}

  const order = allOrdersCache.find(function(o) { return o.ref === ref; });
if (!order) { marketaAlert("Not found", "Order not found."); return; }

  const text = document.getElementById("reviewText").value.trim();
  const fromId = currentUserId;
  const toId = (role === "seller") ? order.sellerId : order.buyerId;

  if (!toId) { marketaAlert("Can't rate", "Can't rate this order (missing party)."); return; }
  if (toId === fromId) { marketaAlert("Can't rate", "Can't rate yourself."); return; }

  const review = {
    id: "rev_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    orderRef: ref,
    fromId: fromId,
    toId: toId,
    role: role,           // "seller" means we're rating a seller
    stars: stars,
    text: text,
    createdAt: Date.now(),
    createdAtStr: new Date().toLocaleString()
  };

  try {
    const { db, doc, setDoc } = await getFsModules();
    await setDoc(doc(db, "reviews", review.id), review);

    // Mark order so the button doesn't show again
    if (role === "seller") order.buyerRatedSeller = true;
    else order.sellerRatedBuyer = true;
    await saveOrderToFirestore(order);
    await loadOrdersFromFirestore();

    closeReviewModal();
marketaToast("Review saved ✅");
    // Refresh whichever view is open
    // Refresh whichever view is open
const _ordersOpen = document.getElementById("ordersModal").style.display === "flex";
const _shopOpen = document.getElementById("shopModal").style.display === "flex";
if (_ordersOpen) openOrders();
if (_shopOpen) openShop();
  } catch (err) {
  marketaAlert("❌ Error", "Failed: " + err.message);
}
}
// Helper for buttons that need to pass an order ref without escaped quotes
function rateBuyerFromData(btn) {
  const ref = btn.getAttribute("data-ref");
  if (ref) openReviewModal(ref, "buyer");
}

function rateSellerFromData(btn) {
  const ref = btn.getAttribute("data-ref");
  if (ref) openReviewModal(ref, "seller");
}
// ============================================
// SELLER RATING — computed from reviews
// ============================================

async function loadSellerRatingForListing(sellerId) {
  const ratingLine = document.getElementById("sellerRatingLine");
  const subLine = document.getElementById("sellerSubLine");
  const seeBtn = document.getElementById("seeReviewsBtn");
  if (!ratingLine || !subLine) return;

  _currentSellerId = sellerId;
  if (seeBtn) seeBtn.style.display = "none";

  if (!sellerId) {
    ratingLine.textContent = "⭐ New Seller";
    subLine.textContent = "No rating yet";
    return;
  }

  try {
    const { db, collection, query, where, getDocs } = await getFsModules();

    const asSellerQ = query(collection(db, "reviews"), where("toId", "==", sellerId));
    const snap = await getDocs(asSellerQ);

    let totalStars = 0;
    let count = 0;
    snap.forEach(function(docSnap) {
      const r = docSnap.data();
      if (r.role === "seller" && typeof r.stars === "number") {
        totalStars += r.stars;
        count++;
      }
    });

    if (count === 0) {
      ratingLine.textContent = "⭐ New Seller";
      subLine.textContent = "No reviews yet — be the first!";
      return;
    }

    const avg = (totalStars / count).toFixed(1);
    ratingLine.textContent = "⭐ " + avg + " / 5";
    subLine.textContent = count + " review" + (count === 1 ? "" : "s");

    // Show the See Reviews button
    if (seeBtn) seeBtn.style.display = "inline-block";
  } catch (err) {
    console.warn("Rating load failed:", err);
    ratingLine.textContent = "⭐ New Seller";
    subLine.textContent = "Rating unavailable";
  }
}
// ============================================
// SELLER REVIEWS MODAL
// ============================================

let _currentSellerId = null;

async function openSellerReviews() {
  if (!_currentSellerId) return;

  const listDiv = document.getElementById("reviewsList");
  const noRevs = document.getElementById("noReviews");
  listDiv.innerHTML = "";

  // Hide the tabs — these belong to own-profile view
  const tabsEl = document.getElementById("reviewsTabs");
  if (tabsEl) tabsEl.style.display = "none";

  // Set the title using the seller's name
  const titleEl = document.getElementById("reviewsModalTitle");
  if (titleEl) {
    // Try to get the seller's name from the listing (already loaded)
    const listing = allListingsCache.find(function (l) {
      return l.sellerId === _currentSellerId;
    });
    let sellerName = "Seller";

    // Prefer the cached display name lookup
    if (_userNameCache[_currentSellerId]) {
      sellerName = _userNameCache[_currentSellerId];
    } else {
      // Fall back to the name shown on the detail page
      const nameEl = document.getElementById("detailSellerName");
      if (nameEl && nameEl.textContent && nameEl.textContent !== "Loading…") {
        sellerName = nameEl.textContent;
      }
    }

    titleEl.textContent = "⭐ " + sellerName + "'s reviews";
  }

  document.getElementById("reviewsModal").classList.add("show");
  // Subscribe to live updates for this seller's reviews
subscribeToSellerReviews(_currentSellerId);

  try {
    const { db, collection, query, where, getDocs } = await getFsModules();

    const q = query(collection(db, "reviews"), where("toId", "==", _currentSellerId));
    const snap = await getDocs(q);

    const reviews = [];
    snap.forEach(function(docSnap) {
      const r = docSnap.data();
      if (r.role === "seller") reviews.push(r);
    });

    reviews.sort(function(a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (reviews.length === 0) {
      noRevs.style.display = "block";
      return;
    }
    noRevs.style.display = "none";

    for (const r of reviews) {
      await appendReviewCard(listDiv, r, "seller");
    }
  } catch (err) {
    console.warn("Reviews load failed:", err);
    noRevs.style.display = "block";
  }
}

function closeSellerReviews() {
  document.getElementById("reviewsModal").classList.remove("show");
  unsubscribeFromSellerReviews();

  // Tell the layer manager we're closed
  popLayer("reviewsModal");
}

// Unified close for the reviews modal — used when we don't
// care which path opened it. Safe to call in all cases.
function closeReviewsModal() {
  document.getElementById("reviewsModal").classList.remove("show");
  try { unsubscribeFromSellerReviews(); } catch (e) {}

  // Tell the layer manager we're closed
  popLayer("reviewsModal");
}
// ============================================
// PWA INSTALL PROMPT
// ============================================

let _deferredInstallPrompt = null;

// Chrome fires this event when the app is installable
window.addEventListener("beforeinstallprompt", function(e) {
  e.preventDefault();
  _deferredInstallPrompt = e;

  // Only show the banner if the user hasn't dismissed it recently
  const dismissedAt = Number(localStorage.getItem("marketaInstallDismissedAt") || 0);
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (Date.now() - dismissedAt > oneDayMs) {
    const banner = document.getElementById("installBanner");
    if (banner) banner.style.display = "flex";
  }
});

// User tapped Install
async function acceptInstall() {
  if (!_deferredInstallPrompt) {
    alert("Install isn't available right now. Try Chrome's menu → 'Install app'.");
    return;
  }
  _deferredInstallPrompt.prompt();
  try {
    const result = await _deferredInstallPrompt.userChoice;
    if (result && result.outcome === "accepted") {
      console.log("✅ User accepted install");
    } else {
      console.log("User dismissed install");
    }
  } catch (err) {
    console.warn("Install prompt error:", err);
  }
  _deferredInstallPrompt = null;
  const banner = document.getElementById("installBanner");
  if (banner) banner.style.display = "none";
}

// User tapped Not now
function dismissInstall() {
  localStorage.setItem("marketaInstallDismissedAt", String(Date.now()));
  const banner = document.getElementById("installBanner");
  if (banner) banner.style.display = "none";
}

// Hide banner if the app is already installed
window.addEventListener("appinstalled", function() {
  console.log("✅ Marketa installed!");
  const banner = document.getElementById("installBanner");
  if (banner) banner.style.display = "none";
});
// ============================================
// HEADER AUTH — show Sign In when logged out
// ============================================

function updateHeaderAuth() {
  const box = document.getElementById("headerAuthBtn");
  if (!box) return;

  // Logout in progress → always show Sign In
  if (_logoutInProgress) {
    box.innerHTML =
      '<button class="sign-in-btn" onclick="openAuthFromHeader()">Sign In</button>';
    return;
  }

  // Firebase hasn't responded yet → show a subtle loading pulse
  if (!_authReady) {
    box.innerHTML = '<div class="auth-loading-pulse"></div>';
    return;
  }

  if (currentAuthUser) {
    const name = currentAuthUser.displayName
      || (currentAuthUser.email ? currentAuthUser.email.split("@")[0] : "there");
    const initial = name.charAt(0).toUpperCase();

    box.innerHTML =
      '<div class="user-greeting" onclick="openProfile()" style="cursor:pointer;">' +
        '<div class="avatar-circle">' + escapeHtml(initial) + '</div>' +
      '</div>';
  } else {
    box.innerHTML =
      '<button class="sign-in-btn" onclick="openAuthFromHeader()">Sign In</button>';
  }
}

// Called from the header button
function openAuthFromHeader() {
  try {
    const modal = document.getElementById("authModal");
    if (!modal) { alert("Modal not found"); return; }

    const loading = document.getElementById("authLoading");
    const forms = document.getElementById("authForms");
    if (loading) loading.style.display = "none";
    if (forms) forms.style.display = "block";

    try {
      switchAuthTab("login");
    } catch (tabErr) {
      console.warn("switchAuthTab failed:", tabErr);
    }

    modal.classList.add("show");
  } catch (err) {
    alert("openAuthFromHeader error: " + err.message);
  }
}
// ============================================
// SAFETY: Force-hide the auth modal on page load
// (browsing is free — login is only for actions)
// ============================================
window.addEventListener("load", function() {
  setTimeout(function() {
    const authModal = document.getElementById("authModal");
    if (authModal) {
      authModal.classList.remove("show");
    }
  }, 300);
});
// ============================================
// ACTION GATING — prompt login for actions that need it
// ============================================

function requireLogin(actionLabel, callback) {
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);

  if (liveUser) {
    currentAuthUser = liveUser;
    currentUserId = liveUser.uid;
    if (typeof callback === "function") callback();
    return;
  }

  // Not logged in — open the auth modal directly with a warm message
  const titleEl = document.getElementById("authTitle");
  if (titleEl) titleEl.textContent = "Sign in to " + actionLabel;
  openAuthFromHeader();
}
// ============================================
// RELIABLE HEADER UPDATE — re-render header whenever auth state is known
// ============================================
window.addEventListener("firebase-ready", function() {
  // After a short delay, sync the header with the current auth state
  setTimeout(function() {
    updateHeaderAuth();
  }, 800);
  setTimeout(function() {
    updateHeaderAuth();
  }, 2000);
});
// ============================================
// HEADER AUTH — auto-sync to actual login state
// ============================================
// Runs every few seconds on the first minute after load.
// Stops once the header matches reality.
(function syncHeaderAuth() {
  let tries = 0;
  const interval = setInterval(function() {
    tries++;
    updateHeaderAuth();
    if (tries >= 20) clearInterval(interval); // stop after ~40s
  }, 2000);
})();
// ============================================
// CLOSE AUTH MODAL
// ============================================
function closeAuth() {
  const modal = document.getElementById("authModal");
  if (modal) {
    modal.classList.remove("show");
    // Clear any error messages
    const errEl = document.getElementById("authError");
    if (errEl) errEl.style.display = "none";
    // Clear input values
    const emailInput = document.getElementById("authEmail");
    const pwdInput = document.getElementById("authPassword");
    const nameInput = document.getElementById("authDisplayName");
    if (emailInput) emailInput.value = "";
    if (pwdInput) pwdInput.value = "";
    if (nameInput) nameInput.value = "";
  }
}
function togglePasswordVisibility() {
  const input = document.getElementById("authPassword");
  if (!input) return;

  const toggle = document.querySelector(".password-toggle");

  if (input.type === "password") {
    input.type = "text";
    if (toggle) toggle.textContent = "🙈";
  } else {
    input.type = "password";
    if (toggle) toggle.textContent = "👁";
  }
}
// ============================================
// PHONE VALIDATION — Ghana numbers
// Accepts:
//   024 456 7890    (local, 10 digits)
//   0244567890
//   +233 24 456 7890  (international)
//   233244567890
// Rejects: everything else
// ============================================
function validateGhanaPhone(raw) {
  if (!raw) return { ok: false, msg: "Please enter your phone number." };

  // Strip spaces, dashes, parentheses
  let cleaned = String(raw).replace(/[\s\-()]/g, "");

  // Convert +233 to 0
  if (cleaned.startsWith("+233")) {
    cleaned = "0" + cleaned.slice(4);
  } else if (cleaned.startsWith("233") && cleaned.length === 12) {
    cleaned = "0" + cleaned.slice(3);
  }

  // Must now be 10 digits, starting with 0
  if (!/^0\d{9}$/.test(cleaned)) {
    return {
      ok: false,
      msg: "Please enter a valid Ghana phone number.\n\nExamples:\n• 024 456 7890\n• 0551234567\n• +233 24 456 7890"
    };
  }

  // First 3 digits must be a real Ghana network prefix
  // (02x, 03x, 05x, 08x, 09x)
  const prefix = cleaned.slice(0, 3);
  const validPrefixes = [
    "020","023","024","025","026","027","028","029",
    "030","031","032","033","034","035","036","037","038","039",
    "050","053","054","055","056","057","058","059",
    "080","083","084","085","086","087","088","089",
    "090","093","094","095","096","097","098","099"
  ];

  if (!validPrefixes.includes(prefix)) {
    return {
      ok: false,
      msg: "That doesn't look like a Ghana phone number.\n\nPlease check and try again (e.g. 024 456 7890)."
    };
  }

  return { ok: true, cleaned: cleaned };
}
// ============================================
// FULL-SCREEN PHOTO VIEWER
// ============================================
let _viewerPhotos = [];
let _viewerIndex = 0;

function openPhotoViewer() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;

  // Collect all photos for this listing
  _viewerPhotos = (item.photos && item.photos.length > 0)
    ? item.photos.slice()
    : (item.photo ? [item.photo] : []);

  if (_viewerPhotos.length === 0) return; // nothing to show

  _viewerIndex = currentPhotoIndex || 0;
  if (_viewerIndex >= _viewerPhotos.length) _viewerIndex = 0;

  renderPhotoViewer();

  const viewer = document.getElementById("photoViewer");
  if (viewer) viewer.style.display = "flex";

  // Reset any previous zoom/pan
  resetViewerZoom();

  // Wire up double-tap-to-zoom (only once)
  attachViewerZoomHandlers();
}

function closePhotoViewer() {
  const viewer = document.getElementById("photoViewer");
  if (viewer) viewer.style.display = "none";
}

function photoViewerPrev() {
  if (_viewerPhotos.length < 2) return;
  _viewerIndex = (_viewerIndex - 1 + _viewerPhotos.length) % _viewerPhotos.length;
  resetViewerZoom();
  renderPhotoViewer();
}

function photoViewerNext() {
  if (_viewerPhotos.length < 2) return;
  _viewerIndex = (_viewerIndex + 1) % _viewerPhotos.length;
  resetViewerZoom();
  renderPhotoViewer();
}

function renderPhotoViewer() {
  const img = document.getElementById("photoViewerImg");
  const counter = document.getElementById("photoViewerCounter");
  const leftBtn = document.querySelector(".photo-viewer-left");
  const rightBtn = document.querySelector(".photo-viewer-right");

  if (img) img.src = _viewerPhotos[_viewerIndex] || "";

  if (counter) {
    if (_viewerPhotos.length > 1) {
      counter.textContent = (_viewerIndex + 1) + " / " + _viewerPhotos.length;
      counter.style.display = "block";
    } else {
      counter.style.display = "none";
    }
  }

  const showArrows = _viewerPhotos.length > 1;
  if (leftBtn) leftBtn.style.display = showArrows ? "flex" : "none";
  if (rightBtn) rightBtn.style.display = showArrows ? "flex" : "none";
}

// Close the viewer with the Escape key (desktop nicety)
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") closePhotoViewer();
});

// ============================================
// Photo viewer — zoom state & helpers
// ============================================
let _viewerZoom = 1;              // 1 = fit, 2 = zoomed in
let _viewerAttached = false;      // so we only wire handlers once

// Pan state (for dragging a zoomed image)
let _viewerPanX = 0;
let _viewerPanY = 0;
let _viewerDragging = false;
let _viewerDragStartX = 0;
let _viewerDragStartY = 0;
let _viewerPanStartX = 0;
let _viewerPanStartY = 0;

function resetViewerZoom() {
  _viewerZoom = 1;
  _viewerPanX = 0;
  _viewerPanY = 0;
  _viewerDragging = false;
  const img = document.getElementById("photoViewerImg");
  if (img) {
    img.style.transform = "";
    img.style.transformOrigin = "center center";
    img.style.cursor = "zoom-in";
  }
}

function attachViewerZoomHandlers() {
  if (_viewerAttached) return;
  const img = document.getElementById("photoViewerImg");
  if (!img) return;

  // ---- Double-tap to zoom ----
  let lastTap = 0;
  img.addEventListener("touchend", function(e) {
    // Only treat as double-tap if we didn't just drag
    if (_viewerDragging) {
      _viewerDragging = false;
      return;
    }
    const now = Date.now();
    if (now - lastTap < 300) {
      e.preventDefault();
      toggleViewerZoom(e);
    }
    lastTap = now;
  });

  // ---- Drag to pan (only when zoomed in) ----
  img.addEventListener("touchstart", function(e) {
    if (_viewerZoom !== 2) return;
    const touch = e.touches[0];
    _viewerDragStartX = touch.clientX;
    _viewerDragStartY = touch.clientY;
    _viewerPanStartX = _viewerPanX;
    _viewerPanStartY = _viewerPanY;
    _viewerDragging = true;
  }, { passive: true });

  img.addEventListener("touchmove", function(e) {
    if (_viewerZoom !== 2 || !_viewerDragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - _viewerDragStartX;
    const dy = touch.clientY - _viewerDragStartY;

    _viewerPanX = _viewerPanStartX + dx;
    _viewerPanY = _viewerPanStartY + dy;

    applyViewerTransform();
    e.preventDefault();
  }, { passive: false });

  img.addEventListener("touchend", function() {
    _viewerDragging = false;
  });

  img.addEventListener("touchcancel", function() {
    _viewerDragging = false;
  });

  _viewerAttached = true;
}

// Combines scale + translate into one transform
function applyViewerTransform() {
  const img = document.getElementById("photoViewerImg");
  if (!img) return;
  img.style.transform =
    "translate(" + _viewerPanX + "px, " + _viewerPanY + "px) scale(" + _viewerZoom + ")";
}

function toggleViewerZoom(e) {
  const img = document.getElementById("photoViewerImg");
  if (!img) return;

  if (_viewerZoom === 1) {
    // Zoom in — 2x, anchored to the tap point
    const rect = img.getBoundingClientRect();
    const touch = (e.changedTouches && e.changedTouches[0]) || null;
    const originX = touch ? ((touch.clientX - rect.left) / rect.width) * 100 : 50;
    const originY = touch ? ((touch.clientY - rect.top) / rect.height) * 100 : 50;

    _viewerPanX = 0;
_viewerPanY = 0;
img.style.transformOrigin = originX + "% " + originY + "%";
_viewerZoom = 2;
applyViewerTransform();
img.style.cursor = "grab";
  } else {
    // Zoom out — back to fit
    img.style.transform = "";
    img.style.transformOrigin = "center center";
    img.style.cursor = "zoom-in";
    _viewerZoom = 1;
    _viewerPanX = 0;
    _viewerPanY = 0;
  }
}

// ============================================
// BOTTOM NAVIGATION
// ============================================
function bottomNavGo(tab) {
  // Close any open overlay/page so nav tabs always switch cleanly.
  // Each page uses a different signal to know if it's open:
  //  - Full-screen pages (Profile, Messages, Listings, Shop, Orders, Settings, Wishlist) → style.display === "flex"
  //  - Modals (Sell) → classList.contains("show")

  const profile = document.getElementById("profilePage");
  if (profile && profile.style.display === "flex") closeProfile();

  const messages = document.getElementById("messagesModal");
  if (messages && messages.style.display === "flex") closeMessages();

  const listings = document.getElementById("listingsModal");
  if (listings && listings.style.display === "flex") closeMyListings();

  const shop = document.getElementById("shopModal");
  if (shop && shop.style.display === "flex") closeShop();

  const orders = document.getElementById("ordersModal");
  if (orders && orders.style.display === "flex") closeOrders();

  const wishlist = document.getElementById("wishlistPage");
  if (wishlist && wishlist.style.display === "flex") closeWishlistPage();

  const settings = document.getElementById("settingsPage");
  if (settings && settings.style.display === "flex") closeSettings();

  const moderation = document.getElementById("moderationPage");
  if (moderation && moderation.style.display === "flex") closeModeration();

  const sell = document.getElementById("sellModal");
  if (sell && sell.classList.contains("show")) toggleSellPage();

  // Visual highlight
  document.querySelectorAll(".bottom-nav-item").forEach(function(el) {
    el.classList.toggle("active", el.getAttribute("data-tab") === tab);
  });

  if (tab === "home") {
  window.scrollTo({ top: 0, behavior: "smooth" });
  closeSupport();

  // User is at home — forget the last location so a
  // future refresh doesn't try to reopen a page.
  clearLastLocation();
  return;
}

  if (tab === "messages") {
    requireLogin("see your messages", openMessages);
    return;
  }

  if (tab === "sell") {
    requireLogin("sell an item", toggleSellPage);
    return;
  }

  if (tab === "mine") {
    openProfile();
    return;
  }
}

// Keep the bottom-nav badge in sync with the header badge
function updateBottomNavBadge() {
  const navBadge = document.getElementById("bottomNavMessagesBadge");
  const headerBadge = document.getElementById("messagesBadge");
  if (!navBadge || !headerBadge) return;

  if (headerBadge.style.display === "flex" && headerBadge.textContent) {
    navBadge.textContent = headerBadge.textContent;
    navBadge.style.display = "flex";
  } else {
    navBadge.style.display = "none";
  }
}
// ============================================
// PROFILE PAGE
// ============================================
async function openProfile() {
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);

  if (!liveUser) {
    // Not logged in → open auth modal
    openAuthFromHeader();
    return;
  }

  // Sync state
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  // Fill in profile data
  const name = liveUser.displayName
    || (liveUser.email ? liveUser.email.split("@")[0] : "User");
  const initial = name.charAt(0).toUpperCase();

  const avatarEl = document.getElementById("profileAvatar");
  const nameEl = document.getElementById("profileDisplayName");
  const emailEl = document.getElementById("profileEmail");

  if (avatarEl) avatarEl.textContent = initial;
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = liveUser.email || "";

// Show the page
const page = document.getElementById("profilePage");
if (page) page.style.display = "flex";

// Highlight the "Mine" tab in the bottom nav  ← NEW
document.querySelectorAll(".bottom-nav-item").forEach(function(el) 
{
  el.classList.toggle("active", el.getAttribute("data-tab") === "mine")
}); 

// Mark the body as "page open" so the FAB hides
document.body.classList.add("page-open");

// Tell the layer manager we're open
pushLayer("profilePage", closeProfile);

  // Load rating + listings asynchronously
  loadProfileStats(liveUser.uid);

  // Populate the new Profile card fields
  populateProfileCardFields(liveUser);
}

function closeProfile() {
  const page = document.getElementById("profilePage");
  if (page) page.style.display = "none";

  // Reset bottom nav to Home
  document.querySelectorAll(".bottom-nav-item").forEach(function(el) {
    el.classList.toggle("active", el.getAttribute("data-tab") === "home");
  });

  // Tell the layer manager we're closed
  popLayer("profilePage");

  // Only remove "page-open" if no other full-screen page is still open
  if (!hasAnotherPageOpen("profilePage")) {
    document.body.classList.remove("page-open");
  }
}

async function loadProfileStats(userId) {
  try {
    const { db, collection, query, where, getDocs } = await getFsModules();

    // Rating
    let totalStars = 0;
    let count = 0;
    const reviewQ = query(collection(db, "reviews"), where("toId", "==", userId));
    const reviewSnap = await getDocs(reviewQ);
    reviewSnap.forEach(function(d) {
      const r = d.data();
      if (typeof r.stars === "number") {
        totalStars += r.stars;
        count++;
      }
    });

    const ratingEl = document.getElementById("profileRating");
    const reviewsEl = document.getElementById("profileReviews");
    if (ratingEl) {
      ratingEl.textContent = count > 0
        ? "⭐ " + (totalStars / count).toFixed(1)
        : "⭐ —";
    }
    if (reviewsEl) reviewsEl.textContent = String(count);

    // Listings count
    const listingQ = query(collection(db, "listings"), where("sellerId", "==", userId));
    const listingSnap = await getDocs(listingQ);
    const listingsEl = document.getElementById("profileListings");
    if (listingsEl) listingsEl.textContent = String(listingSnap.size);

    // Followers count (people following me)
    const followersQ = query(collection(db, "follows"), where("followingId", "==", userId));
    const followersSnap = await getDocs(followersQ);
    const followersEl = document.getElementById("profileFollowers");
    if (followersEl) followersEl.textContent = String(followersSnap.size);

    // Following count (people I follow)
    const followingQ = query(collection(db, "follows"), where("followerId", "==", userId));
    const followingSnap = await getDocs(followingQ);
    const followingEl = document.getElementById("profileFollowing");
    if (followingEl) followingEl.textContent = String(followingSnap.size);

  } catch (err) {
    console.warn("Profile stats failed:", err);
  }
}
function openLegal() {
  marketaAlert(
    "📄 Legal & Policies",
    "Marketa is a marketplace platform. We facilitate escrow-protected transactions between buyers and sellers.\n\nFull terms, privacy policy, and dispute resolution rules will be published soon."
  );
}

// ============================================
// MY REVIEWS — reviews I've received
// ============================================

// Current tab in the reviews modal
// "received" = reviews other people left for me
// "written"  = reviews I've left for other people
let _myReviewsTab = "received";

// Called from the tab pills
function filterMyReviewsTab(tab) {
  _myReviewsTab = tab;
  document.querySelectorAll(".reviews-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  // Re-render the list for the new tab
  renderMyReviewsList();
}

async function openMyReviews() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  const modal = document.getElementById("reviewsModal");
  const titleEl = document.getElementById("reviewsModalTitle");
  const tabsEl = document.getElementById("reviewsTabs");
  if (!modal) return;

  // Set the title
  if (titleEl) titleEl.textContent = "⭐ Your Reviews";

  // Show the tabs
  if (tabsEl) tabsEl.style.display = "flex";

  // Reset to "Received" tab each time we open
  _myReviewsTab = "received";
  document.querySelectorAll(".reviews-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === "received");
  });

  // Show the modal + register with the layer manager
  modal.classList.add("show");
  pushLayer("reviewsModal", closeReviewsModal);

  // Render the current tab
  await renderMyReviewsList();
}

// ============================================
// SHARED REVIEW CARD BUILDER
// ============================================
// Used by:
//   - renderMyReviewsList()      (own profile, tabs)
//   - openSellerReviews()        (someone else's profile)
//   - subscribeToSellerReviews() (live updates)
//
// context = "received" | "written" | "seller"
//
// Returns an element so callers can appendChild() it.

// Builds a review card and APPENDS it directly to a parent.
// (Previous version returned a node — that pattern kept
// failing on some devices. This version appends directly
// so there's no return-value to lose.)
async function appendReviewCard(parentEl, review, context) {
  if (!parentEl) return;

  if (!review) {
    const empty = document.createElement("div");
    empty.className = "review-card";
    empty.textContent = "(invalid review)";
    parentEl.appendChild(empty);
    return;
  }

  const card = document.createElement("div");
  card.className = "review-card";

  // ----- Which user's name do we show? -----
  let subjectId;
  if (context === "written") {
    subjectId = review.toId;
  } else {
    subjectId = review.fromId;
  }

  // ----- Look up the display name -----
  let subjectName = "User";
  try {
    const name = await getDisplayNameByUid(subjectId);
    if (name && typeof name === "string" && name.length > 0) {
      subjectName = name;
    }
  } catch (e) {
    // keep "User"
  }

  const initial = (subjectName || "U").charAt(0).toUpperCase();

  // ----- Stars -----
  const stars = "★".repeat(review.stars || 0) + "☆".repeat(5 - (review.stars || 0));

  // ----- Role label -----
  let roleLabel;
  if (context === "received") {
    roleLabel = (review.role === "seller")
      ? "🛒 Bought from you"
      : "🧑‍💼 Sold to you";
  } else if (context === "written") {
    roleLabel = (review.role === "seller")
      ? "🛒 You bought from them"
      : "🧑‍💼 You sold to them";
  } else {
    roleLabel = (review.role === "seller")
      ? "🛒 From a buyer"
      : "🧑‍💼 From a seller";
  }

  // ----- Optional text -----
  let textHtml = "";
  if (review.text && review.text.trim()) {
    textHtml = '<div class="review-card-text">' + escapeHtml(review.text) + '</div>';
  }

  // ----- Build the HTML -----
  card.innerHTML =
    '<div class="review-card-top">' +
      '<div class="review-card-avatar">' + escapeHtml(initial) + '</div>' +
      '<div class="review-card-who">' +
        '<div class="review-card-name">' + escapeHtml(subjectName) + '</div>' +
        '<div class="review-card-stars">' + stars + '</div>' +
      '</div>' +
    '</div>' +
    textHtml +
    '<div class="review-card-meta">' + roleLabel + ' · ' + escapeHtml(review.createdAtStr || "") + '</div>';

  parentEl.appendChild(card);
}

// Renders the reviews list for the CURRENT tab in openMyReviews.
// Shows "Received" or "Written" based on _myReviewsTab.
async function renderMyReviewsList() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) return;

  const listDiv = document.getElementById("reviewsList");
  const noRevs = document.getElementById("noReviews");
  if (!listDiv || !noRevs) return;

  listDiv.innerHTML = "";
  noRevs.style.display = "none";
  noRevs.textContent = "Loading…";
  noRevs.style.display = "block";

  try {
    const { db, collection, query, where, getDocs } = await getFsModules();

    // Fetch based on the active tab
    const field = (_myReviewsTab === "written") ? "fromId" : "toId";
    const q = query(collection(db, "reviews"), where(field, "==", user.uid));
    const snap = await getDocs(q);

    const reviews = [];
    snap.forEach(function (d) {
      reviews.push(d.data());
    });

    // Sort newest first
    reviews.sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    // Empty state
    if (reviews.length === 0) {
      noRevs.textContent = (_myReviewsTab === "written")
        ? "You haven't written any reviews yet."
        : "No one has reviewed you yet.";
      noRevs.style.display = "block";
      return;
    }

    noRevs.style.display = "none";

    // Render the cards using the shared builder
for (const r of reviews) {
  await appendReviewCard(listDiv, r, _myReviewsTab);
}

    } catch (err) {
    console.warn("Reviews list failed:", err);
    noRevs.textContent = "Couldn't load reviews: " + (err && err.message ? err.message : String(err));
    noRevs.style.display = "block";
  }
}

// ============================================
// NOTIFICATIONS — foundation
// ============================================
// Local + foreground notifications.
//
// Notes:
// - "In-app toast" — a slide-in banner at the top (always available)
// - "Browser notification" — a system-level notification (requires permission)
//
// True background push (when the app is fully closed) requires
// Firebase Cloud Messaging + a paid plan. This foundation lays
// the groundwork for that upgrade.

// Does this browser support the Notification API?
function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

// Current permission state: "default" | "granted" | "denied"
// Returns "unsupported" if the API isn't available.
function getNotificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

// Has the user already been asked (this device)?
function hasBeenAskedForNotifications() {
  return localStorage.getItem("marketaNotifAsked") === "yes";
}

// Mark the "asked" flag. Call this after we show the ask dialog
// — whether they accepted or declined.
function markNotificationsAsked() {
  localStorage.setItem("marketaNotifAsked", "yes");
}

// Did the user opt OUT via our Settings toggle?
// (Separate from the browser-level permission.)
function isNotificationsMuted() {
  return localStorage.getItem("marketaNotifMuted") === "yes";
}

// Turn notifications on/off from the app's own toggle.
function setNotificationsMuted(muted) {
  if (muted) {
    localStorage.setItem("marketaNotifMuted", "yes");
  } else {
    localStorage.removeItem("marketaNotifMuted");
  }
}

// Trigger the native browser permission prompt.
// Returns a promise that resolves to the new permission state.
async function requestNotificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";

  try {
    const result = await Notification.requestPermission();
    return result; // "granted" | "denied" | "default"
  } catch (e) {
    console.warn("Notification.requestPermission failed:", e);
    return "default";
  }
}

// Fire a notification.
// - If the app/tab is VISIBLE → show an in-app toast
// - If the app/tab is HIDDEN  → show a system browser notification
// - If notifications are muted or permission denied → do nothing
//
// `tag` — a unique string per source (e.g. thread id, order ref)
//          so repeated events replace each other rather than pile up.
function sendAppNotification(title, body, tag) {
  // User opted out via our settings
  if (isNotificationsMuted()) return;

  const visible = document.visibilityState === "visible";

  // Foreground → in-app toast
  if (visible) {
    const msg = (title ? title + " — " : "") + (body || "");
    marketaToast(msg);
    return;
  }

  // Background → try a system browser notification
  if (!notificationsSupported()) return;
  if (Notification.permission !== "granted") return;

  try {
    const n = new Notification(title || "Marketa", {
      body: body || "",
      tag: tag || undefined,
      icon: "icon.png",
      badge: "icon.png"
    });

    // Auto-close after 6 seconds
    setTimeout(function () {
      try { n.close(); } catch (e) {}
    }, 6000);

    // Click → focus the app
    n.onclick = function () {
      try {
        window.focus();
        n.close();
      } catch (e) {}
    };
  } catch (err) {
    // Some browsers (iOS Safari) throw if not allowed
    console.warn("Notification() failed:", err);
  }
}

// ============================================
// MARKETA CUSTOM DIALOG — replaces alert()/confirm()
// ============================================
let _dialogOnYes = null;
let _dialogOnNo = null;
let _dialogBackdropCloses = true;

function marketaAlert(title, message, onClose) {
  _dialogOnYes = onClose || null;
  _dialogOnNo = null;
  _dialogBackdropCloses = true;

  document.getElementById("marketaDialogTitle").textContent = title || "Message";
  document.getElementById("marketaDialogText").textContent = message || "";
  document.getElementById("marketaDialogCancel").style.display = "none";
  document.getElementById("marketaDialogConfirm").textContent = "OK";
  document.getElementById("marketaDialog").classList.add("show");

  // Tell the layer manager we're open
  pushLayer("marketaDialog", marketaDialogClose);
}

function marketaConfirm(title, message, onYes, onNo) {
  _dialogOnYes = onYes || null;
  _dialogOnNo = onNo || null;
  _dialogBackdropCloses = false;

  document.getElementById("marketaDialogTitle").textContent = title || "Confirm";
  document.getElementById("marketaDialogText").textContent = message || "";
  document.getElementById("marketaDialogCancel").style.display = "";
  document.getElementById("marketaDialogConfirm").textContent = "Confirm";
  document.getElementById("marketaDialog").classList.add("show");

  // Tell the layer manager we're open
  pushLayer("marketaDialog", marketaDialogClose);
}

function marketaDialogClose() {
  document.getElementById("marketaDialog").classList.remove("show");
  _dialogOnYes = null;
  _dialogOnNo = null;

  // Tell the layer manager we're closed
  popLayer("marketaDialog");
}

function marketaDialogYes() {
  const cb = _dialogOnYes;
  marketaDialogClose();
  if (typeof cb === "function") cb();
}

function marketaDialogNo() {
  const cb = _dialogOnNo;
  marketaDialogClose();
  if (typeof cb === "function") cb();
}

function marketaDialogBackdrop() {
  if (_dialogBackdropCloses) {
    marketaDialogClose();
  }
}

// ============================================
// MARKETA TOAST — small slide-in notification
// ============================================
let _toastTimer = null;
function marketaToast(message) {
  const el = document.getElementById("marketaToast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() {
    el.classList.remove("show");
  }, 2400);
}

// ============================================
// MY LISTINGS — listings only (separate modal from My Shop)
// ============================================
let _myListingsTab = "all";
let _myListingsSelectMode = false;
let _myListingsSelected = [];   // array of listing IDs (not indexes)

async function openMyListings() {
  if (allListingsCache.length === 0) {
    await loadListingsFromFirestore();
  }

  const page = document.getElementById("listingsModal");
  if (!page) return;

  // Reset to "All" tab each time
  _myListingsTab = "all";
  document.querySelectorAll(".my-listings-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === "all");
  });

  renderMyListings();

  page.style.display = "flex";

  // Tell the layer manager we're open
  pushLayer("listingsModal", closeMyListings);
}

// Toggle select mode on My Listings
function toggleMyListingsSelectMode() {
  _myListingsSelectMode = !_myListingsSelectMode;

  const btn = document.getElementById("myListingsSelectBtn");
  const icon = document.getElementById("myListingsSelectIcon");
  const label = document.getElementById("myListingsSelectLabel");
  const count = document.getElementById("myListingsSelCount");
  const allBtn = document.getElementById("myListingsSelectAllBtn");

  if (_myListingsSelectMode) {
    document.body.classList.add("my-listings-selecting");
    if (btn) btn.classList.add("active");
    if (icon) icon.textContent = "✕";
    if (label) label.textContent = "Cancel";
    if (count) count.style.display = "";
    if (allBtn) allBtn.style.display = "";
  } else {
    // Leaving select mode — clear everything
    _myListingsSelected = [];
    document.body.classList.remove("my-listings-selecting");
    if (btn) btn.classList.remove("active");
    if (icon) icon.textContent = "☑️";
    if (label) label.textContent = "Select";
    if (count) count.style.display = "none";
    if (allBtn) allBtn.style.display = "none";
  }

  // Repaint the grid so selection styling updates
  if (typeof renderMyListings === "function") renderMyListings();
  updateMyListingsSelCounter();
}

// Updates the "N selected" counter + "Select all / Clear" label
// AND shows/hides the floating action bar with correct enable states.
function updateMyListingsSelCounter() {
  const count = document.getElementById("myListingsSelCount");
  const allBtn = document.getElementById("myListingsSelectAllBtn");
  const bar = document.getElementById("myListingsActionBar");
  if (!count || !allBtn) return;

  // If select mode is off, hide everything and bail
  if (!_myListingsSelectMode) {
    count.style.display = "none";
    allBtn.style.display = "none";
    if (bar) bar.style.display = "none";
    return;
  }

  // Select mode is on — show counter
  count.style.display = "";
  const n = _myListingsSelected.length;
  count.textContent = n + " selected";

  // Select all / Clear label
  const mine = allListingsCache.filter(function (l) { return l.sellerId === currentUserId; });
  const shown = _myListingsGetShownItems(mine);

  if (shown.length === 0) {
    allBtn.style.display = "none";
  } else if (n > 0 && n >= shown.length) {
    allBtn.style.display = "";
    allBtn.textContent = "Clear";
  } else {
    allBtn.style.display = "";
    allBtn.textContent = "Select all";
  }

  // ---- Floating action bar ----
  if (!bar) return;

  if (n === 0) {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";

  // Enable/disable each button based on what's actually selected
  const selectedItems = _myListingsSelected.map(function (id) {
    return allListingsCache.find(function (l) { return String(l.id) === String(id); });
  }).filter(Boolean);

  const hasActive = selectedItems.some(function (l) { return !l.sold && !l.hidden; });
  const hasSold   = selectedItems.some(function (l) { return !!l.sold; });
  const hasAny    = selectedItems.length > 0;

  const soldBtn   = document.getElementById("mlActionSold");
  const relistBtn = document.getElementById("mlActionRelist");
  const deleteBtn = document.getElementById("mlActionDelete");

  if (soldBtn)   soldBtn.disabled   = !hasActive;
  if (relistBtn) relistBtn.disabled = !hasSold;
  if (deleteBtn) deleteBtn.disabled = !hasAny;
}

// Returns the currently-visible listings on this tab (used by Select all)
function _myListingsGetShownItems(mine) {
  if (_myListingsTab === "active") {
    return mine.filter(function (l) { return !l.sold && !l.hidden; });
  }
  if (_myListingsTab === "sold") {
    return mine.filter(function (l) { return !!l.sold; });
  }
  if (_myListingsTab === "removed") {
    return mine.filter(function (l) { return !!l.hidden; });
  }
  return mine;
}

// ============================================
// MY LISTINGS — Bulk actions
// ============================================

// Shared helper: run a per-listing action, collecting success/skip counts.
// actionFn returns true on success, false on skip.
async function _myListingsRunBulk(selectedIds, actionFn) {
  let succeeded = 0;
  let skipped = 0;

  for (const id of selectedIds) {
    const item = allListingsCache.find(function (l) { return String(l.id) === String(id); });
    if (!item) { skipped++; continue; }

    try {
      const ok = await actionFn(item);
      if (ok) succeeded++; else skipped++;
    } catch (err) {
      console.warn("Bulk action failed for", id, err);
      skipped++;
    }
  }

  return { succeeded, skipped };
}

// Shared helper: build the final toast text
function _myListingsBulkToast(verbPast, succeeded, skipped, skipReason) {
  let msg = succeeded + " " + verbPast;
  if (skipped > 0) {
    msg += " · " + skipped + " skipped";
    if (skipReason) msg += " (" + skipReason + ")";
  }
  marketaToast(msg);
}

// Shared helper: exit select mode + refresh
function _myListingsBulkFinish() {
  _myListingsSelected = [];
  if (_myListingsSelectMode) {
    toggleMyListingsSelectMode();  // turns it off cleanly
  } else {
    renderMyListings();
    updateMyListingsSelCounter();
  }
}

// ---------- MARK SOLD ----------
function myListingsBulkMarkSold() {
  const selectedItems = _myListingsSelected
    .map(function (id) {
      return allListingsCache.find(function (l) { return String(l.id) === String(id); });
    })
    .filter(function (l) {
      // Only active listings can be marked sold
      return l && !l.sold && !l.hidden;
    });

  if (selectedItems.length === 0) {
    marketaToast("Nothing to mark sold");
    return;
  }

  const count = selectedItems.length;
  marketaConfirm(
    "📦 Mark " + count + " listing" + (count === 1 ? "" : "s") + " as sold?",
    "They'll be moved to your Sold tab. You can relist them any time.",
    async function () {
      const { db, doc, setDoc } = await getFsModules();

      const result = await _myListingsRunBulk(_myListingsSelected, async function (item) {
        // Skip if it's not in a state we can act on
        if (item.sold || item.hidden) return false;

        const updated = Object.assign({}, item, { sold: true });
        await setDoc(doc(db, "listings", String(item.id)), updated);

        // Update the local cache so the UI reflects it immediately
        item.sold = true;
        return true;
      });

      await loadListingsFromFirestore().catch(function (e) { console.warn(e); });
      renderListings(allListingsCache);

      _myListingsBulkFinish();
      _myListingsBulkToast("marked sold", result.succeeded, result.skipped, "already sold");
    },
    null
  );
}

// ---------- RELIST ----------
function myListingsBulkRelist() {
  const selectedItems = _myListingsSelected
    .map(function (id) {
      return allListingsCache.find(function (l) { return String(l.id) === String(id); });
    })
    .filter(function (l) {
      // Only sold, non-removed listings can be relisted
      return l && l.sold && !l.hidden;
    });

  if (selectedItems.length === 0) {
    marketaToast("Nothing to relist");
    return;
  }

  const count = selectedItems.length;
  marketaConfirm(
    "↻ Relist " + count + " listing" + (count === 1 ? "" : "s") + "?",
    "They'll be visible to buyers again.",
    async function () {
      const { db, doc, setDoc } = await getFsModules();

      const result = await _myListingsRunBulk(_myListingsSelected, async function (item) {
        if (!item.sold || item.hidden) return false;

        const updated = Object.assign({}, item, { sold: false });
        await setDoc(doc(db, "listings", String(item.id)), updated);

        item.sold = false;
        return true;
      });

      await loadListingsFromFirestore().catch(function (e) { console.warn(e); });
      renderListings(allListingsCache);

      _myListingsBulkFinish();
      _myListingsBulkToast("relisted", result.succeeded, result.skipped, "not sold");
    },
    null
  );
}

// ---------- DELETE ----------
function myListingsBulkDelete() {
  if (_myListingsSelected.length === 0) {
    marketaToast("Nothing to delete");
    return;
  }

  const count = _myListingsSelected.length;
  marketaConfirm(
    "🗑 Delete " + count + " listing" + (count === 1 ? "" : "s") + "?",
    "This cannot be undone.",
    async function () {
      const { db, doc, deleteDoc } = await getFsModules();

      // Same terminal-status rule as the single-delete flow
      const terminalStatuses = ["Funds released to seller", "refunded"];

      const result = await _myListingsRunBulk(_myListingsSelected, async function (item) {
        // Skip if there's an active order on this listing
        const activeOrder = allOrdersCache.find(function (o) {
          return o.itemId === item.id && terminalStatuses.indexOf(o.status) === -1;
        });
        if (activeOrder) return false;

        await deleteDoc(doc(db, "listings", String(item.id)));
        return true;
      });

      await loadListingsFromFirestore().catch(function (e) { console.warn(e); });
      renderListings(allListingsCache);

      _myListingsBulkFinish();
      _myListingsBulkToast("deleted", result.succeeded, result.skipped, "has an active order");
    },
    null
  );
}

// Select all / Clear — based on the CARDS ACTUALLY ON SCREEN
function myListingsSelectAll() {
  // Read the listing IDs straight from the DOM — ground truth
  const cards = document.querySelectorAll('#myListingsGrid .my-listing-card');
  const visibleIds = [];
  cards.forEach(function (card) {
    const id = card.dataset.listingId;
    if (id !== undefined && id !== null && id !== "") {
      // Normalize: ids may be numbers in cache but strings in dataset
      visibleIds.push(String(id));
    }
  });

  if (visibleIds.length === 0) {
    // Nothing on screen — nothing to do
    return;
  }

  // Are ALL visible cards already selected?
  const allSelected = visibleIds.every(function (id) {
    return _myListingsSelected.map(String).indexOf(id) !== -1;
  });

  if (allSelected) {
    // Clear the visible ones
    _myListingsSelected = _myListingsSelected.filter(function (id) {
      return visibleIds.indexOf(String(id)) === -1;
    });
  } else {
    // Add every visible one that isn't already selected
    visibleIds.forEach(function (id) {
      const already = _myListingsSelected.map(String).indexOf(id) !== -1;
      if (!already) {
        // Store as string so comparisons stay consistent
        _myListingsSelected.push(id);
      }
    });
  }

  renderMyListings();
  updateMyListingsSelCounter();
}

// Tick / untick a single listing by its id
function toggleMyListingSelection(listingId) {
  if (!_myListingsSelectMode) return;

  // Normalize to string so dataset values and cache ids always match
  const id = String(listingId);

  const idx = _myListingsSelected.map(String).indexOf(id);
  if (idx >= 0) {
    _myListingsSelected.splice(idx, 1);
  } else {
    _myListingsSelected.push(id);
  }

  // Update the one card in place
  const card = document.querySelector('.my-listing-card[data-listing-id="' + id + '"]');
  if (card) {
    card.classList.toggle("selected", _myListingsSelected.map(String).indexOf(id) !== -1);
  }

  updateMyListingsSelCounter();
}

function closeMyListings() {
  // Always exit select mode when leaving the page
  _myListingsSelectMode = false;
  _myListingsSelected = [];
  document.body.classList.remove("my-listings-selecting");
  const _actionBar = document.getElementById("myListingsActionBar");
  if (_actionBar) _actionBar.style.display = "none";
  const _selBtn = document.getElementById("myListingsSelectBtn");
  if (_selBtn) _selBtn.classList.remove("active");
  const _selIcon = document.getElementById("myListingsSelectIcon");
  if (_selIcon) _selIcon.textContent = "☑️";
  const _selLabel = document.getElementById("myListingsSelectLabel");
  if (_selLabel) _selLabel.textContent = "Select";

  const page = document.getElementById("listingsModal");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("listingsModal");
}

// Re-render the listings grid using the current tab
function renderMyListings() {
  const grid = document.getElementById("myListingsGrid");
  const empty = document.getElementById("myListingsEmpty");
  if (!grid || !empty) return;

  // Grab all my listings — INCLUDING hidden ones
  // (sellers should see what was removed)
  const mine = allListingsCache.filter(function (item) {
    return item.sellerId === currentUserId;
  }).sort(function (a, b) {
    const aT = a.postedAt || Number(a.id) || 0;
    const bT = b.postedAt || Number(b.id) || 0;
    return bT - aT;
  });

  // Stats
// Active = visible to buyers (not sold, not hidden)
// Sold = sale completed
// (Removed listings are counted in Total only)
const total = mine.length;
const active = mine.filter(function (l) { return !l.sold && !l.hidden; }).length;
const sold = mine.filter(function (l) { return !!l.sold; }).length;

  const totalEl = document.getElementById("myListingsTotal");
  const activeEl = document.getElementById("myListingsActive");
  const soldEl = document.getElementById("myListingsSold");
  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
  if (soldEl) soldEl.textContent = sold;

  // Filter by tab
let shown = mine;
if (_myListingsTab === "active") {
  // Active = visible to buyers (not sold, not hidden)
  shown = mine.filter(function (l) { return !l.sold && !l.hidden; });
} else if (_myListingsTab === "sold") {
  shown = mine.filter(function (l) { return !!l.sold; });
} else if (_myListingsTab === "removed") {
  // Removed by admin (hidden flag)
  shown = mine.filter(function (l) { return !!l.hidden; });
}

  // Render
  grid.innerHTML = "";

  if (shown.length === 0) {
  empty.style.display = "block";
  if (_myListingsTab === "all") {
    empty.querySelector(".empty-state-title").textContent = "No listings yet";
    empty.querySelector(".empty-state-text").innerHTML = "Your posted ads will appear here.<br>Tap \"Post a new ad\" to get started.";
} else if (_myListingsTab === "active") {
  empty.querySelector(".empty-state-title").textContent = "No active listings";
  empty.querySelector(".empty-state-text").innerHTML = "Ads that are visible to buyers will appear here.";
} else if (_myListingsTab === "sold") {
  empty.querySelector(".empty-state-title").textContent = "No sold listings";
  empty.querySelector(".empty-state-text").innerHTML = "Once you sell an item, it will appear here.";
} else if (_myListingsTab === "removed") {
  empty.querySelector(".empty-state-title").textContent = "No removed listings";
  empty.querySelector(".empty-state-text").innerHTML = "Good news — none of your ads have been removed by the moderation team.";
}
  return;
}

  empty.style.display = "none";

  shown.forEach(function (item) {
  const card = createMyListingCard(item);
  // Re-apply the selected state (survives re-renders)
  if (_myListingsSelected.map(String).indexOf(String(item.id)) !== -1) {
    card.classList.add("selected");
  }
  grid.appendChild(card);
});
}

// Build one listing card for My Listings
function createMyListingCard(item) {
  const card = document.createElement("div");
  card.className = "my-listing-card";
  card.dataset.listingId = item.id;
  
  // Photo
  const photos = (item.photos && item.photos.length > 0)
    ? item.photos
    : (item.photo ? [item.photo] : []);
  const thumb = photos[0] || null;

  // Time
  const timeText = (item.postedAt || Number(item.id)) ? timeAgo(item.postedAt || Number(item.id)) : "";

// Badge (removed > sold > active)
let badgeClass = "active";
let badgeText = "Active";
if (item.hidden) {
  badgeClass = "removed";
  badgeText = "🚫 Removed";
} else if (item.sold) {
  badgeClass = "sold";
  badgeText = "Sold";
}

// The primary contextual button
// Removed listings can't be marked sold or relisted
const isSold = !!item.sold;
const isRemoved = !!item.hidden;
let statusBtn = "";
if (isRemoved) {
  // No action button — the listing is under moderation
  statusBtn = "";
} else if (isSold) {
  statusBtn = '<button class="my-listing-btn green" onclick="relistListing(' + allListingsCache.findIndex(function (l) { return l.id === item.id; }) + ')">↻ Relist</button>';
} else {
  statusBtn = '<button class="my-listing-btn green" onclick="toggleSold(' + allListingsCache.findIndex(function (l) { return l.id === item.id; }) + ')">↻ Mark sold</button>';
}

  // Build HTML
  card.innerHTML =
    '<div class="my-listing-thumb">' +
      (thumb ? '<img src="' + thumb + '" alt="">' : '📦') +
    '</div>' +
    '<div class="my-listing-toprow">' +
      '<span class="my-listing-badge ' + badgeClass + '">' + badgeText + '</span>' +
      (timeText ? '<span class="my-listing-time">' + escapeHtml(timeText) + '</span>' : '') +
    '</div>' +
    '<div class="my-listing-title">' + escapeHtml(formatTitle(item.name)) + '</div>' +
    '<div class="my-listing-price-row">' +
      '<span class="my-listing-price">GH₵ ' + Number(item.price).toLocaleString() + '</span>' +
'<span class="my-listing-meta-item">' + locationIcon() + ' ' + escapeHtml(item.location || "—") + '</span>' +
'<span class="my-listing-meta-item">👁 ' + (Number(item.views) || 0) + ' view' + ((Number(item.views) || 0) === 1 ? "" : "s") + '</span>' +
    '</div>' +
    '<div class="my-listing-actions">' +
      '<button class="my-listing-btn" onclick="viewMyListing(' + allListingsCache.findIndex(function (l) { return l.id === item.id; }) + ')">👁 View</button>' +
      '<button class="my-listing-btn" onclick="startEditListing(' + allListingsCache.findIndex(function (l) { return l.id === item.id; }) + ')">✏️ Edit</button>' +
      statusBtn +
    '</div>' +
    '<button class="my-listing-btn danger" onclick="deleteListing(' + allListingsCache.findIndex(function (l) { return l.id === item.id; }) + ')">🗑 Delete</button>';

  // In select mode, tapping the card toggles selection
// instead of opening the listing.
card.addEventListener("click", function (e) {
  if (_myListingsSelectMode) {
    e.preventDefault();
    e.stopPropagation();
    toggleMyListingSelection(item.id);
  }
}, true);   // useCapture = true so it fires before any button handlers

// Checkbox overlay (appended last so it sits on top of the thumbnail)
const checkbox = document.createElement("div");
checkbox.className = "my-listing-checkbox";
card.appendChild(checkbox);

  return card;
}

// Tab switching
function filterMyListings(tab) {
  _myListingsTab = tab;
  document.querySelectorAll(".my-listings-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  renderMyListings();
}

// "Relist" a sold listing — un-marks sold
async function relistListing(index) {
  const item = allListingsCache[index];
  if (!item) return;

  marketaConfirm(
    "↻ Relist this ad",
    "This will mark the listing as available again. Buyers will be able to see and purchase it.",
    async function () {
      try {
        const { db, doc, setDoc } = await getFsModules();
        const updated = Object.assign({}, item, { sold: false });
        await setDoc(doc(db, "listings", String(item.id)), updated);
        await loadListingsFromFirestore();
        renderMyListings();
        marketaToast("Listing relisted ✅");
      } catch (err) {
        marketaAlert("❌ Error", "Failed: " + err.message);
      }
    },
    null
  );
}

// "View" — opens the listing detail
function viewMyListing(index) {
  // Hide it visually, but KEEP it in the layer stack so Back returns here
  const page = document.getElementById("listingsModal");
  if (page) page.style.display = "none";
  
  setTimeout(function () { showDetail(index); }, 200);
}

// ============================================
// FULL-SCREEN SEARCH PAGE
// ============================================
let _searchPageTab = "products";

function openSearchPage() {
  const page = document.getElementById("searchPage");
  if (!page) return;
  page.style.display = "flex";

  // Focus the input so the keyboard opens
  setTimeout(function() {
    const input = document.getElementById("searchPageInput");
    if (input) input.focus();
  }, 100);

  // Render current results (empty by default)
  searchPageQuery();

  // If My Listings was open, make sure it's still in the stack
// so we know to return to it.
if (document.getElementById("listingsModal") && document.getElementById("listingsModal").style.display === "flex") {
    // (It's still visible, which means we opened it from My Listings)
}

// Tell the layer manager we're open
pushLayer("detailModal", closeDetail);
}

function closeSearchPage() {
  const page = document.getElementById("searchPage");
  if (page) page.style.display = "none";

  // Clear input
  const input = document.getElementById("searchPageInput");
  if (input) input.value = "";

  const clear = document.getElementById("searchPageClear");
  if (clear) clear.style.display = "none";

  _searchPageTab = "products";
  document.querySelectorAll(".search-page-tab").forEach(function(el) {
    el.classList.toggle("active", el.getAttribute("data-tab") === "products");
  });

  // Tell the layer manager we're closed
  popLayer("searchPage");
}

function clearSearchPageInput() {
  const input = document.getElementById("searchPageInput");
  const cond = document.getElementById("searchCondition");
  const sort = document.getElementById("searchSort");
  const min = document.getElementById("searchMinPrice");
  const max = document.getElementById("searchMaxPrice");

  if (input) input.value = "";
  if (cond) cond.value = "";
  if (sort) sort.value = "newest";
  if (min) min.value = "";
  if (max) max.value = "";
  
  if (input) input.focus();
  searchPageQuery();
}

function searchPageSetTab(tab) {
  _searchPageTab = tab;
  document.querySelectorAll(".search-page-tab").forEach(function(el) {
    el.classList.toggle("active", el.getAttribute("data-tab") === tab);
  });
  searchPageQuery();
}

function searchPageQuery() {
  const input = document.getElementById("searchPageInput");
  const results = document.getElementById("searchPageResults");
  const empty = document.getElementById("searchPageEmpty");
  const clear = document.getElementById("searchPageClear");
  if (!input || !results || !empty) return;

  const query = (input.value || "").toLowerCase().trim();
  const conditionEl = document.getElementById("searchCondition");
  const sortEl = document.getElementById("searchSort");
  const minEl = document.getElementById("searchMinPrice");
  const maxEl = document.getElementById("searchMaxPrice");

  const condition = conditionEl ? (conditionEl.value || "").toLowerCase().trim() : "";
  const sort = sortEl ? (sortEl.value || "newest") : "newest";
  const minPrice = minEl ? (Number(minEl.value) || 0) : 0;
  const maxPrice = maxEl && maxEl.value !== "" ? Number(maxEl.value) : Infinity;

  // Show/hide clear button
  if (clear) clear.style.display = query ? "flex" : "none";

  // No query AND no filters → show hint
  const hasFilters = query || condition || minPrice > 0 || maxPrice !== Infinity;
  if (!hasFilters) {
    results.innerHTML = "";
    empty.textContent = "Type something to search for products on Marketa.";
    empty.style.display = "block";
    return;
  }

  // Sellers tab not yet built → show hint
  if (_searchPageTab === "sellers") {
    results.innerHTML = "";
    empty.textContent = "Seller search is coming soon.";
    empty.style.display = "block";
    return;
  }

  // Products tab: filter listings
  let matches = allListingsCache.filter(function(item) {
    if (item.sold) return false;
    if (item.hidden) return false;

    // Query match (name, location, category, sub-category)
if (query) {
  const name = (item.name || "").toLowerCase();
  const loc = (item.location || "").toLowerCase();
  const cat = (item.category || "").toLowerCase();
  const subCat = (item.subCategory || "").toLowerCase();
  if (!name.includes(query) && !loc.includes(query) && !cat.includes(query) && !subCat.includes(query)) {
    return false;
  }
}

    // Condition match
    if (condition && (item.condition || "").toLowerCase() !== condition) {
      return false;
    }

    // Price match
    const p = Number(item.price) || 0;
    if (p < minPrice || p > maxPrice) {
      return false;
    }

    return true;
  });

  // Exclude sellers I've blocked
  matches = filterOutBlockedSellers(matches);

  // Sort
  if (sort === "priceLow") {
    matches.sort(function(a, b) { return (Number(a.price) || 0) - (Number(b.price) || 0); });
  } else if (sort === "priceHigh") {
    matches.sort(function(a, b) { return (Number(b.price) || 0) - (Number(a.price) || 0); });
  } else {
    matches.sort(function(a, b) {
      const aT = a.postedAt || Number(a.id) || 0;
      const bT = b.postedAt || Number(b.id) || 0;
      return bT - aT;
    });
  }

  if (matches.length === 0) {
    results.innerHTML = "";
    empty.innerHTML =
      '<div style="font-size:44px;margin-bottom:12px;opacity:0.5;">🔍</div>' +
      '<div style="font-weight:700;color:var(--text-dark);margin-bottom:6px;">No results found</div>' +
      '<div style="color:var(--text-gray);font-size:13px;margin-bottom:16px;">Try a different keyword or adjust your filters.</div>' +
      '<button class="shop-empty-btn" onclick="clearSearchPageInput()">Clear search</button>';
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  results.innerHTML = "";

  matches.forEach(function(item) {
    const realIndex = allListingsCache.findIndex(function(l) { return l.id === item.id; });
    if (realIndex >= 0) {
      results.appendChild(createCard(item, realIndex));
    }
  });
}

// ============================================
// DETAIL PAGE HELPERS — 6A
// ============================================
function closeDetail() {
  document.getElementById("detailModal").classList.remove("show");

  // Refresh the "Continue browsing" row on the homepage
  if (typeof renderRecentlyViewed === "function") {
    renderRecentlyViewed();
  }

  // Tell the layer manager we're closed
  popLayer("detailModal");

  // Which page was underneath? Bring it back!
  if (_layerStack.some(function(l) { return l.id === "listingsModal"; })) {
    // Return to My Listings
    const listingsModal = document.getElementById("listingsModal");
    if (listingsModal) listingsModal.style.display = "flex";
  } else if (_layerStack.some(function(l) { return l.id === "shopModal"; })) {
    // Return to My Shop
    const shopModal = document.getElementById("shopModal");
    if (shopModal) shopModal.style.display = "flex";
  } else if (_layerStack.some(function(l) { return l.id === "wishlistPage"; })) {
    // Return to Wishlist
    const wishlistPage = document.getElementById("wishlistPage");
    if (wishlistPage) wishlistPage.style.display = "flex";
  } else if (_layerStack.some(function(l) { return l.id === "messagesModal"; })) {
     // Return to Messages (if opened from chat)
     const messagesModal = document.getElementById("messagesModal");
     if (messagesModal) messagesModal.style.display = "flex";
  } else {
    // If nothing is underneath, remove the page-open class
    if (!hasAnotherPageOpen("detailModal")) {
      document.body.classList.remove("page-open");
    }
  }
}

function shareListing() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;

  const shareData = {
    title: formatTitle(item.name),
    text: formatTitle(item.name) + " — GH₵ " + Number(item.price).toLocaleString() + " on Marketa",
    url: window.location.href
  };

  if (navigator.share) {
    navigator.share(shareData).catch(function() { /* user cancelled */ });
  } else {
    // Fallback: copy link
    const link = window.location.href;
    navigator.clipboard.writeText(link).then(function() {
      marketaToast("Link copied 📋");
    }).catch(function() {
      marketaToast("Couldn't share");
    });
  }
}

function renderRelatedProducts(item) {
  const grid = document.getElementById("detailRelatedGrid");
  const section = document.getElementById("detailRelatedSection");
  const titleEl = document.getElementById("detailSimilarTitle");
  if (!grid || !section) return;

  grid.innerHTML = "";

  if (!item.category) {
    section.style.display = "none";
    return;
  }

  // Update the header text
  if (titleEl) {
    titleEl.textContent = "Similar ads in " + item.category.replace(/^[^\w\s]+\s/, "");
  }

let related = allListingsCache.filter(function(l) {
  return l.category === item.category &&
         l.id !== item.id &&
         !l.sold &&
         !l.hidden;
});

// Exclude sellers I've blocked
related = filterOutBlockedSellers(related);

// Cap at 10
related = related.slice(0, 10);

  if (related.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";

  related.forEach(function(rel) {
    const realIndex = allListingsCache.findIndex(function(l) { return l.id === rel.id; });
    if (realIndex >= 0) {
      grid.appendChild(createSimilarAdCard(rel, realIndex));
    }
  });
}

// Compact card for the "Similar ads" horizontal row.
function createSimilarAdCard(item, index) {
  const card = document.createElement("div");
  card.className = "similar-ad-card";

  const photos = (item.photos && item.photos.length > 0)
    ? item.photos
    : (item.photo ? [item.photo] : []);
  const thumb = photos[0] || null;
  const timeText = (item.postedAt || Number(item.id))
    ? timeAgo(item.postedAt || Number(item.id))
    : "";

  card.innerHTML =
    '<div class="similar-ad-thumb">' +
      (thumb ? '<img src="' + thumb + '" alt="">' : '<div class="similar-ad-placeholder">📦</div>') +
      '<span class="similar-ad-badge">🛡 ESCROW</span>' +
    '</div>' +
    '<div class="similar-ad-body">' +
      '<div class="similar-ad-price">GH₵ ' + Number(item.price).toLocaleString() + '</div>' +
      '<div class="similar-ad-title">' + escapeHtml(formatTitle(item.name)) + '</div>' +
'<div class="similar-ad-meta">' + locationIcon() + ' ' + escapeHtml(item.location || "—") + '</div>' + (timeText ? 
'<div class="similar-ad-time">' + escapeHtml(timeText) + '</div>' : '') +
    '</div>';

  card.addEventListener("click", function () {
    closeDetail();
    setTimeout(function () { showDetail(index); }, 200);
  });

  return card;
}

async function renderSellerBlock(item) {
  const avatarEl = document.getElementById("detailSellerAvatar");
  const nameEl = document.getElementById("detailSellerName");
  const badgeEl = document.getElementById("detailSellerVerifiedBadge");

  // Reset the badge immediately — hides between listings
  if (badgeEl) badgeEl.style.display = "none";

  if (!item.sellerId) {
    if (avatarEl) avatarEl.textContent = "?";
    if (nameEl) nameEl.textContent = "Unknown Seller";
    return;
  }

  // Show placeholder immediately
  if (avatarEl) avatarEl.textContent = "…";
  if (nameEl) nameEl.textContent = "Loading…";

  // Look up the real name
  const name = await getDisplayNameByUid(item.sellerId);
  const initial = (name || "M").charAt(0).toUpperCase();

  if (avatarEl) avatarEl.textContent = initial;
  if (nameEl) nameEl.textContent = name;

  // Check verification (async, non-blocking)
  isSellerVerified(item.sellerId).then(function (verified) {
    // Only show if this is still the same seller (edge case: user
    // switched listings while the promise was pending)
    if (!badgeEl) return;
    const currentItem = allListingsCache[currentItemIndex];
    if (!currentItem || currentItem.sellerId !== item.sellerId) return;

    badgeEl.style.display = verified ? "inline-flex" : "none";
  }).catch(function (e) {
    console.warn("Verification check failed:", e);
  });

  // Reset the phone button for the new seller
  resetSellerPhoneButton(item.sellerId);
  updateBlockButton(item.sellerId);
}

// ============================================
// WISHLIST
// ============================================
let _wishlistCache = [];         // array of { id, userId, listingId, addedAt }
let _wishlistLoaded = false;
let _wishlistUnsubscribe = null;

async function loadWishlistFromFirestore() {
  if (!currentAuthUser) { _wishlistCache = []; _wishlistLoaded = true; return []; }
  try {
    const { db, collection, query, where, getDocs } = await getFsModules();
    const q = query(collection(db, "wishlists"), where("userId", "==", currentUserId));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(function(d) {
      const data = d.data();
      data._docId = d.id;
      items.push(data);
    });
    _wishlistCache = items;
    _wishlistLoaded = true;
    return items;
  } catch (err) {
    console.warn("Wishlist load failed:", err);
    _wishlistCache = [];
    _wishlistLoaded = true;
    return [];
  }
}

function isListingWishlisted(listingId) {
  return _wishlistCache.some(function(w) { return w.listingId === listingId; });
}

async function toggleWishlist() {
  // Require login
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) {
    openAuthFromHeader();
    return;
  }
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  const item = allListingsCache[currentItemIndex];
  if (!item) return;

  // Ensure wishlist is loaded
  if (!_wishlistLoaded) await loadWishlistFromFirestore();

  const existing = _wishlistCache.find(function(w) { return w.listingId === item.id; });

  try {
    const { db, doc, setDoc, deleteDoc } = await getFsModules();

    if (existing) {
      await deleteDoc(doc(db, "wishlists", existing._docId));
      _wishlistCache = _wishlistCache.filter(function(w) { return w.listingId !== item.id; });
      marketaToast("Removed from wishlist");
    } else {
      const newId = "wish_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const entry = {
        userId: currentUserId,
        listingId: item.id,
        addedAt: Date.now()
      };
      await setDoc(doc(db, "wishlists", newId), entry);
      entry._docId = newId;
      _wishlistCache.push(entry);
      marketaToast("Saved to wishlist ❤️");
    }

    // Update the heart button on the detail page
    updateWishlistButton(item.id);

    // If the wishlist page is open, re-render it live
    const wishlistOpen = document.getElementById("wishlistPage").style.display === "flex";
    if (wishlistOpen) {
      refreshWishlistGrid();
    }
  } catch (err) {
    marketaAlert("❌ Error", "Couldn't update wishlist: " + err.message);
  }
}

// Lightweight refresh — re-renders the grid without reloading everything
function refreshWishlistGrid() {
  const grid = document.getElementById("wishlistGrid");
  const empty = document.getElementById("wishlistEmpty");
  if (!grid || !empty) return;

  grid.innerHTML = "";

  if (_wishlistCache.length === 0) {
    empty.innerHTML = "No saved items yet.<br><br>Tap the 🤍 on any listing to save it here.";
    empty.style.display = "block";
    return;
  }

  const saved = _wishlistCache.slice().sort(function(a, b) {
    return (b.addedAt || 0) - (a.addedAt || 0);
  });

  const items = saved.map(function (w) {
  return allListingsCache.find(function (l) { return l.id === w.listingId && !l.hidden; });
}).filter(Boolean);

  if (items.length === 0) {
    empty.innerHTML = "No saved items yet.<br><br>Tap the 🤍 on any listing to save it here.";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  items.forEach(function(item) {
    const realIndex = allListingsCache.findIndex(function(l) { return l.id === item.id; });
    if (realIndex >= 0) {
      grid.appendChild(createCard(item, realIndex));
    }
  });
}

function updateWishlistButton(listingId) {
  const btn = document.getElementById("detailWishlistBtn");
  if (!btn) return;
  if (isListingWishlisted(listingId)) {
    btn.classList.add("saved");
    btn.setAttribute("aria-label", "Remove from wishlist");
  } else {
    btn.classList.remove("saved");
    btn.setAttribute("aria-label", "Save to wishlist");
  }
}

// ============================================
// SAVED ITEMS PAGE
// ============================================
async function openWishlistPage() {
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) { openAuthFromHeader(); return; }
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  const page = document.getElementById("wishlistPage");
  if (!page) return;

  page.style.display = "flex";

  // Tell the layer manager we're open
  pushLayer("wishlistPage", closeWishlistPage);

  // Load fresh data
  try {
    await loadListingsFromFirestore().catch(function (e) { console.warn(e); });
    await loadWishlistFromFirestore();
    renderSavedItems();
  } catch (err) {
    console.warn("Saved items page failed:", err);
  }
}

function closeWishlistPage() {
  const page = document.getElementById("wishlistPage");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("wishlistPage");
}

// Render the saved items grid + count pill
function renderSavedItems() {
  const grid = document.getElementById("wishlistGrid");
  const empty = document.getElementById("wishlistEmpty");
  const countPill = document.getElementById("wishlistCount");
  if (!grid || !empty) return;

  grid.innerHTML = "";

  // Sort by newest saved first
  const saved = _wishlistCache.slice().sort(function (a, b) {
    return (b.addedAt || 0) - (a.addedAt || 0);
  });

  // Map to listings
  const items = saved.map(function (w) {
  return allListingsCache.find(function (l) { return l.id === w.listingId && !l.hidden; });
}).filter(Boolean);

  // Update count
  if (countPill) {
    countPill.textContent = items.length + " saved";
  }

  if (items.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  items.forEach(function (item) {
  const card = document.createElement("div");
  card.className = "history-item";
  
  const photos = (item.photos && item.photos.length > 0) ? item.photos : (item.photo ? [item.photo] : []);
  const thumb = photos[0] || null;
  
  card.innerHTML =
    '<div class="history-thumb">' +
      (thumb ? '<img src="' + thumb + '" alt="">' : '📦') +
    '</div>' +
    '<div class="history-info">' +
      '<div class="history-price">GH₵ ' + Number(item.price).toLocaleString() + '</div>' +
      '<div class="history-title">' + escapeHtml(formatTitle(item.name)) + '</div>' +
      '<div class="history-meta">' + locationIcon() + ' ' + escapeHtml(item.location || "—") + '</div>' +
    '</div>';
    
  card.onclick = function () {
    const realIndex = allListingsCache.findIndex(function (l) { return l.id === item.id; });
    if (realIndex >= 0) {
      closeBrowseHistory();
      setTimeout(function () { showDetail(realIndex); }, 200);
    }
  };
  
  grid.appendChild(card);
});
}

// Alias so old code calling refreshWishlistGrid still works
function refreshWishlistGrid() {
  renderSavedItems();
}

// Build a single saved-item card
function createSavedCard(item) {
  const card = document.createElement("div");
  card.className = "saved-card";

  // Photo
  const photos = (item.photos && item.photos.length > 0)
    ? item.photos
    : (item.photo ? [item.photo] : []);
  const thumb = photos[0] || null;

  // Time
  const timeText = (item.postedAt || Number(item.id)) ? timeAgo(item.postedAt || Number(item.id)) : "";

  // Condition badge
  let badgeHtml = "";
  if (item.condition) {
    badgeHtml = '<span class="saved-badge">' + escapeHtml(item.condition) + '</span>';
  }

  card.innerHTML =
    '<div class="saved-card-thumb">' +
      (thumb ? '<img src="' + thumb + '" alt="">' : '📦') +
      badgeHtml +
      '<button class="saved-heart" onclick="event.stopPropagation(); unsaveFromGrid(' + allListingsCache.findIndex(function (l) { return l.id === item.id; }) + ')" title="Remove from saved">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="#DC2626" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>' +
        '</svg>' +
      '</button>' +
    '</div>' +
    '<div class="saved-card-body">' +
      '<div class="saved-price">GH₵ ' + Number(item.price).toLocaleString() + '</div>' +
      '<div class="saved-title">' + escapeHtml(formatTitle(item.name)) + '</div>' +
'<div class="saved-meta">' + locationIcon() + ' ' + escapeHtml(item.location || "—") + '</div>' +      (timeText ? 
'<div class="saved-time">' + escapeHtml(timeText) + '</div>' : '') +
    '</div>';

  // Click the card (but not the heart) opens the detail
  card.style.cursor = "pointer";
  card.onclick = function () {
    const realIndex = allListingsCache.findIndex(function (l) { return l.id === item.id; });
    if (realIndex >= 0) {
      closeWishlistPage();
      setTimeout(function () { showDetail(realIndex); }, 200);
    }
  };

  return card;
}

// Unsave from within the grid (taps the heart)
async function unsaveFromGrid(index) {
  const item = allListingsCache[index];
  if (!item) return;

  const existing = _wishlistCache.find(function (w) { return w.listingId === item.id; });
  if (!existing) return;

  try {
    const { db, doc, deleteDoc } = await getFsModules();
    await deleteDoc(doc(db, "wishlists", existing._docId));
    _wishlistCache = _wishlistCache.filter(function (w) { return w.listingId !== item.id; });
    renderSavedItems();
    marketaToast("Removed from saved");
  } catch (err) {
    marketaAlert("❌ Error", "Couldn't unsave: " + err.message);
  }
}

function closeWishlistPage() {
  const page = document.getElementById("wishlistPage");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("wishlistPage");
}
// ============================================
// FOLLOW SELLERS
// ============================================
let _followsCache = [];       // array of { _docId, followerId, followingId, createdAt }
let _followsLoaded = false;
let _followsUnsubscribe = null;
let _incomingFollowsCache = [];           // people following me
let _incomingFollowsUnsubscribe = null;

async function loadFollowsFromFirestore() {
  if (!currentAuthUser) {
    _followsCache = [];
    _followsLoaded = true;
    return [];
  }
  try {
    const { db, collection, query, where, getDocs } = await getFsModules();
    const q = query(collection(db, "follows"), where("followerId", "==", currentUserId));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(function(d) {
      const data = d.data();
      data._docId = d.id;
      items.push(data);
    });
    _followsCache = items;
    _followsLoaded = true;
    return items;
  } catch (err) {
    console.warn("Follows load failed:", err);
    _followsCache = [];
    _followsLoaded = true;
    return [];
  }
}

async function subscribeToFollows() {
  if (_followsUnsubscribe) {
    try { _followsUnsubscribe(); } catch (e) {}
    _followsUnsubscribe = null;
  }
  if (!currentAuthUser) return;

  try {
    const { db, collection, query, where, onSnapshot } = await getFsModules();
    const q = query(collection(db, "follows"), where("followerId", "==", currentUserId));
    _followsUnsubscribe = onSnapshot(q, function(snap) {
  const items = [];
  snap.forEach(function(d) {
    const data = d.data();
    data._docId = d.id;
    items.push(data);
  });
  _followsCache = items;
  _followsLoaded = true;

  // Live-update the Following count on the profile
  const followingEl = document.getElementById("profileFollowing");
  if (followingEl) followingEl.textContent = String(items.length);

  // Live-update the Following page if open
  const followingOpen = document.getElementById("followingPage").style.display === "flex";
  if (followingOpen) {
    renderFollowingList();
  }

  // If a detail modal is open, refresh the button state
  const detailOpen = document.getElementById("detailModal").classList.contains("show");
  if (detailOpen) {
    const item = allListingsCache[currentItemIndex];
    if (item && item.sellerId) {
      updateFollowButton(item.sellerId);
    }
  }
}, function(err) {
  console.warn("Follows subscription error:", err);
    });
  } catch (err) {
    console.warn("Could not subscribe to follows:", err);
  }
}
function isFollowingSeller(sellerId) {
  return _followsCache.some(function(f) { return f.followingId === sellerId; });
}

async function toggleFollowSeller() {
  // Require login
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) { openAuthFromHeader(); return; }
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  const item = allListingsCache[currentItemIndex];
  if (!item || !item.sellerId) return;

  if (item.sellerId === currentUserId) {
    marketaAlert("Can't follow", "You can't follow yourself. 😄");
    return;
  }

  if (!_followsLoaded) await loadFollowsFromFirestore();

  const existing = _followsCache.find(function(f) { return f.followingId === item.sellerId; });

  try {
    const { db, doc, setDoc, deleteDoc } = await getFsModules();

    if (existing) {
      await deleteDoc(doc(db, "follows", existing._docId));
      _followsCache = _followsCache.filter(function(f) { return f.followingId !== item.sellerId; });
      marketaToast("Unfollowed");
    } else {
      const newId = "follow_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const entry = {
        followerId: currentUserId,
        followingId: item.sellerId,
        createdAt: Date.now()
      };
      await setDoc(doc(db, "follows", newId), entry);
      entry._docId = newId;
      _followsCache.push(entry);
      marketaToast("Following ✅");
    }

    updateFollowButton(item.sellerId);
    loadFollowerCountForSeller(item.sellerId);
  } catch (err) {
    marketaAlert("❌ Error", "Couldn't update follow: " + err.message);
  }
}

function updateFollowButton(sellerId) {
  const btn = document.getElementById("detailFollowBtn");
  if (!btn) return;

  // Hide button if this is my own listing
  if (sellerId === currentUserId) {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "";
  if (isFollowingSeller(sellerId)) {
    btn.textContent = "Following";
    btn.classList.add("following");
  } else {
    btn.textContent = "Follow";
    btn.classList.remove("following");
  }
}

async function loadFollowerCountForSeller(sellerId) {
  const text = document.getElementById("followerCountText");
  if (!text || !sellerId) return;

  try {
    const { db, collection, query, where, getDocs } = await getFsModules();
    const q = query(collection(db, "follows"), where("followingId", "==", sellerId));
    const snap = await getDocs(q);
    const count = snap.size;
    text.textContent = count + " follower" + (count === 1 ? "" : "s");
  } catch (err) {
    console.warn("Follower count failed:", err);
    text.textContent = "0 followers";
  }
}

// ============================================
// BLOCK USERS — state + helpers
// ============================================
// One-way block. When I block someone:
//   • I stop seeing their listings everywhere
//   • Neither of us can send new messages
//   • But the whole existing chat history stays
//     visible on both sides (evidence).
//
// Stored on my user doc as: blockedUsers: [uid, uid, ...]
// Managed via Settings → Blocked users.

// One-time read of my blocked list.
async function loadBlockedUsersFromFirestore() {
  if (!currentAuthUser) {
    _blockedUsersCache = [];
    _blockedUsersLoaded = true;
    return [];
  }
  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", currentUserId));
    if (snap.exists()) {
      const data = snap.data();
      _blockedUsersCache = Array.isArray(data.blockedUsers) ? data.blockedUsers.slice() : [];
    } else {
      _blockedUsersCache = [];
    }
    _blockedUsersLoaded = true;
    return _blockedUsersCache;
  } catch (err) {
    console.warn("loadBlockedUsersFromFirestore failed:", err);
    _blockedUsersCache = [];
    _blockedUsersLoaded = true;
    return [];
  }
}

// Live subscription — keeps the cache in sync when I
// block/unblock from another device or tab.
async function subscribeToBlockedUsers() {
  if (_blockedUsersUnsubscribe) {
    try { _blockedUsersUnsubscribe(); } catch (e) {}
    _blockedUsersUnsubscribe = null;
  }
  if (!currentAuthUser) return;

  try {
    const { db, doc, onSnapshot } = await getFsModules();
    _blockedUsersUnsubscribe = onSnapshot(
      doc(db, "users", currentUserId),
      function (docSnap) {
  if (!docSnap.exists()) return;
  const data = docSnap.data();
  _blockedUsersCache = Array.isArray(data.blockedUsers) ? data.blockedUsers.slice() : [];
  _blockedUsersLoaded = true;
  // Recompute the filtered listing view now that we
// have the block list.
recomputeFilteredListings();

  // Live-refresh the blocked-users page if it's open
  const pageOpen = document.getElementById("blockedUsersPage")
    && document.getElementById("blockedUsersPage").style.display === "flex";
  if (pageOpen && typeof renderBlockedUsers === "function") {
    renderBlockedUsers();
  }

  // Re-render the home grid so blocked sellers' listings
  // disappear immediately (or reappear on unblock).
  // Skip if the detail modal is open — the grid is hidden
  // behind it anyway.
  const detailOpen = document.getElementById("detailModal").classList.contains("show");
  if (!detailOpen && typeof renderListings === "function") {
    renderListings(allListingsCache);
  }

  // If Browse / Search is open, refresh those too
  const browseOpen = document.getElementById("browsePage").style.display === "flex";
  if (browseOpen && typeof applyBrowseFilters === "function") {
    applyBrowseFilters();
  }
  const searchOpen = document.getElementById("searchPage").style.display === "flex";
  if (searchOpen && typeof searchPageQuery === "function") {
    searchPageQuery();
  }
},
      function (err) {
        console.warn("subscribeToBlockedUsers error:", err);
      }
    );
  } catch (err) {
    console.warn("Could not subscribe to blocked users:", err);
  }
}

// ============================================
// BLOCKED USERS PAGE
// ============================================

async function openBlockedUsersPage() {
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) { openAuthFromHeader(); return; }
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  const page = document.getElementById("blockedUsersPage");
  if (!page) return;

  const settingsPage = document.getElementById("settingsPage");
  if (settingsPage) settingsPage.style.display = "none";

  page.style.display = "flex";
  document.body.classList.add("page-open");

  pushLayer("blockedUsersPage", closeBlockedUsersPage);

  if (!_blockedUsersLoaded) {
    await loadBlockedUsersFromFirestore();
  }

  renderBlockedUsers();
}

function closeBlockedUsersPage() {
  const page = document.getElementById("blockedUsersPage");
  if (page) page.style.display = "none";

  popLayer("blockedUsersPage");

  if (_layerStack.some(function (l) { return l.id === "settingsPage"; })) {
    const settingsPage = document.getElementById("settingsPage");
    if (settingsPage) settingsPage.style.display = "flex";
  } else {
    if (!hasAnotherPageOpen("blockedUsersPage")) {
      document.body.classList.remove("page-open");
    }
  }
}

async function renderBlockedUsers() {
  const list = document.getElementById("blockedUsersList");
  const empty = document.getElementById("blockedUsersEmpty");
  const countEl = document.getElementById("blockedUsersCount");
  if (!list || !empty) return;

  list.innerHTML = "";

  const ids = getBlockedIds();

  if (countEl) {
    countEl.textContent = ids.length + " blocked";
  }

  if (ids.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  const rows = await Promise.all(ids.map(async function (uid) {
    const name = await getDisplayNameByUid(uid);
    return buildBlockedUserRow(uid, name);
  }));

  rows.forEach(function (row) { list.appendChild(row); });
}

function buildBlockedUserRow(uid, displayName) {
  const row = document.createElement("div");
  row.className = "follow-row";

  const initial = (displayName || "?").charAt(0).toUpperCase();

  row.innerHTML =
    '<div class="follow-row-avatar">' + escapeHtml(initial) + '</div>' +
    '<div class="follow-row-info">' +
      '<div class="follow-row-name">' + escapeHtml(displayName || "User") + '</div>' +
      '<div class="follow-row-sub">Blocked</div>' +
    '</div>' +
    '<button class="mod-remove-btn" style="flex-shrink:0;">Unblock</button>';

  const btn = row.querySelector("button");
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    marketaConfirm(
      "🔓 Unblock this user?",
      "They'll be able to message you again, and you'll see their listings.",
      async function () {
        const ok = await unblockUser(uid);
        if (ok) {
          marketaToast("Unblocked ✅");
          renderBlockedUsers();
        } else {
          marketaAlert("❌ Error", "Couldn't unblock. Please try again.");
        }
      },
      null
    );
  });

  return row;
}

// Refreshes every view that shows listings, so a block/unblock
// update is reflected everywhere immediately.
function refreshAllViewsAfterBlockChange() {
  // Homepage grid
  const listingsDiv = document.querySelector(".listings");
  if (listingsDiv && typeof renderListings === "function") {
    renderListings(allListingsCache);
  }

  // Browse page (if open)
  const browseOpen = document.getElementById("browsePage") &&
                     document.getElementById("browsePage").style.display === "flex";
  if (browseOpen && typeof applyBrowseFilters === "function") {
    applyBrowseFilters();
  }

  // Search page (if open)
  const searchOpen = document.getElementById("searchPage") &&
                     document.getElementById("searchPage").style.display === "flex";
  if (searchOpen && typeof searchPageQuery === "function") {
    searchPageQuery();
  }

  // User listings page (if open)
  const userListingsOpen = document.getElementById("userListingsPage") &&
                           document.getElementById("userListingsPage").style.display === "flex";
  if (userListingsOpen) {
    const title = document.getElementById("userListingsTitle");
    const uid = title && title.dataset ? title.dataset.uid : null;
    if (uid && typeof openUserListingsPage === "function") {
      openUserListingsPage(uid, title.textContent);
    }
  }

  // Wishlist page (if open)
  const wishlistOpen = document.getElementById("wishlistPage") &&
                       document.getElementById("wishlistPage").style.display === "flex";
  if (wishlistOpen && typeof refreshWishlistGrid === "function") {
    refreshWishlistGrid();
  }

  // Recently viewed row on the homepage
  if (typeof renderRecentlyViewed === "function") {
    renderRecentlyViewed();
  }
}

// Returns the current array of blocked uids.
function getBlockedIds() {
  return _blockedUsersCache.slice();
}

// Is the given uid currently blocked by me?
function isUserBlocked(uid) {
  if (!uid) return false;
  return _blockedUsersCache.indexOf(uid) !== -1;
}

// Filters an array of listings, returning only those whose
// seller is NOT blocked by me. Non-mutating — returns a new
// array. Safe to call repeatedly.
function filterOutBlockedSellers(items) {
  if (!Array.isArray(items)) return [];
  if (!_blockedUsersCache || _blockedUsersCache.length === 0) return items;
  return items.filter(function (item) {
    if (!item || !item.sellerId) return true;
    return _blockedUsersCache.indexOf(item.sellerId) === -1;
  });
}

// Add uid to my blocked list. Returns true on success.
async function blockUser(uid) {
  if (!uid || !currentAuthUser) return false;
  if (uid === currentUserId) return false;              // can't block self
  if (isUserBlocked(uid)) return true;                  // already blocked

  const next = _blockedUsersCache.slice();
  next.push(uid);
  _blockedUsersCache = next;                            // optimistic update

  // Recompute the filtered view immediately so the UI updates
  // without waiting for Firestore to round-trip.
  recomputeFilteredListings();
  renderListings(allListingsCache);

  // Also refresh any other open views
  refreshAllViewsAfterBlockChange();

  try {
    const { db, doc, setDoc } = await getFsModules();
    await setDoc(
      doc(db, "users", currentUserId),
      { blockedUsers: next, updatedAt: Date.now() },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn("blockUser failed:", err);
    // Roll back the optimistic update
    _blockedUsersCache = _blockedUsersCache.filter(function (x) { return x !== uid; });
    recomputeFilteredListings();
    renderListings(allListingsCache);
    refreshAllViewsAfterBlockChange();
    return false;
  }
}

// Remove uid from my blocked list. Returns true on success.
async function unblockUser(uid) {
  if (!uid || !currentAuthUser) return false;
  if (!isUserBlocked(uid)) return true;

  const next = _blockedUsersCache.filter(function (x) { return x !== uid; });
  _blockedUsersCache = next;                            // optimistic update

  // Recompute + re-render immediately
  recomputeFilteredListings();
  renderListings(allListingsCache);
  refreshAllViewsAfterBlockChange();

  try {
    const { db, doc, setDoc } = await getFsModules();
    await setDoc(
      doc(db, "users", currentUserId),
      { blockedUsers: next, updatedAt: Date.now() },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn("unblockUser failed:", err);
    // Roll back
    _blockedUsersCache = _blockedUsersCache.concat([uid]);
    recomputeFilteredListings();
    renderListings(allListingsCache);
    refreshAllViewsAfterBlockChange();
    return false;
  }
}

// ============================================
// VERIFICATION BADGES — helpers
// ============================================
// Users with `verified: true` on their user doc get a tick
// next to their name on the detail page seller block.

// Cache: uid → true/false
const _verifiedCache = {};

// Looks up whether a given uid is verified. Cached so we
// don't hit Firestore repeatedly for the same seller.
async function isSellerVerified(uid) {
  if (!uid) return false;

  // Cache hit
  if (_verifiedCache[uid] !== undefined) return _verifiedCache[uid];

  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data();
      const verified = data.verified === true;
      _verifiedCache[uid] = verified;
      return verified;
    }
  } catch (err) {
    console.warn("isSellerVerified failed:", err);
  }

  _verifiedCache[uid] = false;
  return false;
}

// Synchronous cache check — returns true/false/undefined.
// Useful when we don't want to await.
function isSellerVerifiedSync(uid) {
  if (!uid) return false;
  return _verifiedCache[uid];
}

// Clears the cache entry for a uid — call after toggling
// verification so the next read is fresh.
function invalidateVerifiedCache(uid) {
  if (uid && _verifiedCache[uid] !== undefined) {
    delete _verifiedCache[uid];
  }
}


// ============================================
// SAVE USER PROFILE — so names show on listings
// ============================================
async function saveUserProfileToFirestore(user) {
  if (!user) return;
  try {
    const { db, doc, setDoc, getDoc } = await getFsModules();
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};

    const payload = {
      uid: user.uid,
      displayName: user.displayName || existing.displayName || (user.email ? user.email.split("@")[0] : "Member"),
      email: user.email || existing.email || "",
      updatedAt: Date.now(),
      createdAt: existing.createdAt || Date.now(),
      // Preserve the admin flag if it exists
      isAdmin: existing.isAdmin === true
    };

    await setDoc(ref, payload, { merge: true });
  } catch (err) {
    console.warn("saveUserProfile failed:", err);
  }
}

// Look up a display name by uid (with fallback)
const _userNameCache = {};
async function getDisplayNameByUid(uid) {
  if (!uid) return "Seller";
  if (_userNameCache[uid]) return _userNameCache[uid];

  try {
    const { db, doc, getDoc, collection, query, where, getDocs } = await getFsModules();

    // First try exact uid match
    let snap = await getDoc(doc(db, "users", uid));

    // If not found, try query by uid field (case-insensitive search)
    if (!snap.exists()) {
      const q = query(collection(db, "users"), where("uid", "==", uid));
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        snap = qSnap.docs[0];
      }
    }

    if (snap.exists && snap.exists()) {
      const data = snap.data();
      if (data.displayName
          && data.displayName.trim().length > 0
          && data.displayName.trim() !== "Member") {
        _userNameCache[uid] = data.displayName;
        return data.displayName;
      }
    }
  } catch (err) {
    console.warn("Lookup failed:", err);
  }

  // Fallback — try email prefix, then an anonymous handle
  let fallback = null;
  try {
    const { db, doc, getDoc } = await getFsModules();
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      const ud = userSnap.data();
      if (ud.email && ud.email.includes("@")) {
        const prefix = ud.email.split("@")[0];
        if (prefix && prefix.length > 1) {
          fallback = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }
      }
    }
  } catch (err) {
    // ignore
  }

  if (!fallback) {
    const shortId = String(uid).slice(-4);
    fallback = "Seller " + shortId;
  }

  _userNameCache[uid] = fallback;
  return fallback;
}
// ============================================
// FOLLOWERS / FOLLOWING / USER LISTINGS PAGES
// ============================================

async function openFollowersPage() {
  const page = document.getElementById("followersPage");
  const empty = document.getElementById("followersEmpty");
  if (!page || !empty) return;
  
  // Tell the layer manager we're open
pushLayer("followersPage", closeFollowersPage);

  page.style.display = "flex";
  empty.textContent = "Loading…";
  empty.style.display = "block";

  // If we haven't subscribed yet, load fresh
  if (!_incomingFollowsUnsubscribe) {
    try {
      const { db, collection, query, where, getDocs } = await getFsModules();
      const q = query(collection(db, "follows"), where("followingId", "==", currentUserId));
      const snap = await getDocs(q);
      const items = [];
      snap.forEach(function(d) {
        const data = d.data();
        data._docId = d.id;
        items.push(data);
      });
      _incomingFollowsCache = items;
    } catch (err) {
      console.warn("Followers page failed:", err);
    }
  }

  renderFollowersList();
}

function closeFollowersPage() {
  const page = document.getElementById("followersPage");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("followersPage");
}

async function openFollowingPage() {
  const page = document.getElementById("followingPage");
  const empty = document.getElementById("followingEmpty");
  if (!page || !empty) return;
  
  // Tell the layer manager we're open
pushLayer("followingPage", closeFollowingPage);

  page.style.display = "flex";
  empty.textContent = "Loading…";
  empty.style.display = "block";

  // If we haven't subscribed yet, load fresh
  if (!_followsUnsubscribe) {
    try {
      const { db, collection, query, where, getDocs } = await getFsModules();
      const q = query(collection(db, "follows"), where("followerId", "==", currentUserId));
      const snap = await getDocs(q);
      const items = [];
      snap.forEach(function(d) {
        const data = d.data();
        data._docId = d.id;
        items.push(data);
      });
      _followsCache = items;
      _followsLoaded = true;
    } catch (err) {
      console.warn("Following page failed:", err);
    }
  }

  renderFollowingList();
}

function closeFollowingPage() {
  const page = document.getElementById("followingPage");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("followingPage");
}

// Shared row builder — returns a DOM element
function buildFollowRow(uid, displayName) {
  const row = document.createElement("div");
  row.className = "follow-row";
  row.onclick = function() { openUserListingsPage(uid, displayName); };

  const initial = (displayName || "S").charAt(0).toUpperCase();

  row.innerHTML =
    '<div class="follow-row-avatar">' + escapeHtml(initial) + '</div>' +
    '<div class="follow-row-info">' +
      '<div class="follow-row-name">' + escapeHtml(displayName || "Seller") + '</div>' +
      '<div class="follow-row-sub">Tap to view listings</div>' +
    '</div>' +
    '<span class="follow-row-chevron">›</span>';

  return row;
}

// ============================================
// USER LISTINGS PAGE
// ============================================
async function openUserListingsPage(uid, displayName) {
  const page = document.getElementById("userListingsPage");
  const grid = document.getElementById("userListingsGrid");
  const empty = document.getElementById("userListingsEmpty");
  const title = document.getElementById("userListingsTitle");
  if (!page || !grid || !empty) return;

// Tell the layer manager we're open
pushLayer("userListingsPage", closeUserListingsPage);

  if (title) {
  title.textContent = displayName || "Listings";
  title.dataset.uid = uid;
}

  // Save this page as the last location so a refresh can restore it.
  saveLastLocation("userListingsPage", { uid: uid, name: displayName || "Listings" });

  page.style.display = "flex";
  grid.innerHTML = "";
  empty.textContent = "Loading…";
  empty.style.display = "block";

  try {
    const { db, collection, query, where, getDocs } = await getFsModules();
    const q = query(collection(db, "listings"), where("sellerId", "==", uid));
    const snap = await getDocs(q);

   const items = [];
snap.forEach(function(d) {
  const data = d.data();
  if (!data.sold && !data.hidden) items.push(data);
});

    if (items.length === 0) {
      empty.textContent = "This user has no active listings.";
      empty.style.display = "block";
      return;
    }

    empty.style.display = "none";
    grid.innerHTML = "";

    items.forEach(function(item) {
      // Add to cache if missing so createCard can work
      let realIndex = allListingsCache.findIndex(function(l) { return l.id === item.id; });
      if (realIndex === -1) {
        allListingsCache.push(item);
        realIndex = allListingsCache.length - 1;
      }
      grid.appendChild(createCard(item, realIndex));
    });

  } catch (err) {
    console.warn("User listings failed:", err);
    empty.textContent = "Couldn't load listings.";
    empty.style.display = "block";
  }
}

function closeUserListingsPage() {
  const page = document.getElementById("userListingsPage");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("userListingsPage");
}
// ============================================
// WISHLIST — real-time subscription
// ============================================
async function subscribeToWishlist() {
  if (_wishlistUnsubscribe) {
    try { _wishlistUnsubscribe(); } catch (e) {}
    _wishlistUnsubscribe = null;
  }
  if (!currentAuthUser) return;

  try {
    const { db, collection, query, where, onSnapshot } = await getFsModules();
    const q = query(collection(db, "wishlists"), where("userId", "==", currentUserId));
    _wishlistUnsubscribe = onSnapshot(q, function(snap) {
      const items = [];
      snap.forEach(function(d) {
        const data = d.data();
        data._docId = d.id;
        items.push(data);
      });
      _wishlistCache = items;
      _wishlistLoaded = true;

      // Live-update the wishlist page if open
      const wishlistOpen = document.getElementById("wishlistPage").style.display === "flex";
      if (wishlistOpen) {
        refreshWishlistGrid();
      }

      // Live-update the heart button if a detail modal is open
      const detailOpen = document.getElementById("detailModal").classList.contains("show");
      if (detailOpen) {
        const item = allListingsCache[currentItemIndex];
        if (item) updateWishlistButton(item.id);
      }
    }, function(err) {
      console.warn("Wishlist subscription error:", err);
    });
  } catch (err) {
    console.warn("Could not subscribe to wishlist:", err);
  }
}
// ============================================
// INCOMING FOLLOWS — real-time (who follows me)
// ============================================
async function subscribeToIncomingFollows() {
  if (_incomingFollowsUnsubscribe) {
    try { _incomingFollowsUnsubscribe(); } catch (e) {}
    _incomingFollowsUnsubscribe = null;
  }
  if (!currentAuthUser) return;

  try {
    const { db, collection, query, where, onSnapshot } = await getFsModules();
    const q = query(collection(db, "follows"), where("followingId", "==", currentUserId));
    _incomingFollowsUnsubscribe = onSnapshot(q, function(snap) {
      const items = [];
      snap.forEach(function(d) {
        const data = d.data();
        data._docId = d.id;
        items.push(data);
      });
      _incomingFollowsCache = items;

      // Live-update the follower count on the profile
      const followersEl = document.getElementById("profileFollowers");
      if (followersEl) followersEl.textContent = String(items.length);

      // Live-update the Followers page if open
      const followersOpen = document.getElementById("followersPage").style.display === "flex";
      if (followersOpen) {
        renderFollowersList();
      }
    }, function(err) {
      console.warn("Incoming follows subscription error:", err);
    });
  } catch (err) {
    console.warn("Could not subscribe to incoming follows:", err);
  }
}

// Render the Followers list from the cache
async function renderFollowersList() {
  const list = document.getElementById("followersList");
  const empty = document.getElementById("followersEmpty");
  if (!list || !empty) return;

  list.innerHTML = "";

  if (_incomingFollowsCache.length === 0) {
    empty.textContent = "No followers yet.";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  const followerIds = [];
  _incomingFollowsCache.forEach(function(f) {
    if (f.followerId && !followerIds.includes(f.followerId)) {
      followerIds.push(f.followerId);
    }
  });

  const rows = await Promise.all(followerIds.map(async function(uid) {
    const name = await getDisplayNameByUid(uid);
    return buildFollowRow(uid, name);
  }));

  rows.forEach(function(row) { list.appendChild(row); });
}
// ============================================
// FOLLOWING LIST — live render from cache
// ============================================
async function renderFollowingList() {
  const list = document.getElementById("followingList");
  const empty = document.getElementById("followingEmpty");
  if (!list || !empty) return;

  list.innerHTML = "";

  if (_followsCache.length === 0) {
    empty.textContent = "You're not following anyone yet.";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  const followingIds = [];
  _followsCache.forEach(function(f) {
    if (f.followingId && !followingIds.includes(f.followingId)) {
      followingIds.push(f.followingId);
    }
  });

  const rows = await Promise.all(followingIds.map(async function(uid) {
    const name = await getDisplayNameByUid(uid);
    return buildFollowRow(uid, name);
  }));

  rows.forEach(function(row) { list.appendChild(row); });
}
// ============================================
// REVIEWS — real-time subscription for my profile
// ============================================
let _myReviewsUnsubscribe = null;
let _reviewsCache = [];        // { toId: [...] } aggregate cache

async function subscribeToMyReviews() {
  if (_myReviewsUnsubscribe) {
    try { _myReviewsUnsubscribe(); } catch (e) {}
    _myReviewsUnsubscribe = null;
  }
  if (!currentAuthUser) return;

  try {
    const { db, collection, query, where, onSnapshot } = await getFsModules();
    const q = query(collection(db, "reviews"), where("toId", "==", currentUserId));
    _myReviewsUnsubscribe = onSnapshot(q, function(snap) {
      // Update rating + review count on the profile
      let totalStars = 0;
      let count = 0;
      snap.forEach(function(d) {
        const r = d.data();
        if (typeof r.stars === "number") {
          totalStars += r.stars;
          count++;
        }
      });

      const ratingEl = document.getElementById("profileRating");
      const reviewsEl = document.getElementById("profileReviews");
      if (ratingEl) {
        ratingEl.textContent = count > 0
          ? "⭐ " + (totalStars / count).toFixed(1)
          : "⭐ —";
      }
      if (reviewsEl) reviewsEl.textContent = String(count);

      // If the reviews modal is open and showing "My Reviews", refresh it
      const reviewsModalOpen = document.getElementById("reviewsModal").classList.contains("show");
      const titleEl = document.getElementById("reviewsModalTitle");
      if (reviewsModalOpen && titleEl && titleEl.textContent === "⭐ My Reviews") {
        if (typeof openMyReviews === "function") {
          openMyReviews();
        }
      }
    }, function(err) {
      console.warn("My reviews subscription error:", err);
    });
  } catch (err) {
    console.warn("Could not subscribe to my reviews:", err);
  }
}
// ============================================
// SELLER REVIEWS — live subscription for the open modal
// ============================================
let _sellerReviewsUnsubscribe = null;

async function subscribeToSellerReviews(sellerId) {
  if (_sellerReviewsUnsubscribe) {
    try { _sellerReviewsUnsubscribe(); } catch (e) {}
    _sellerReviewsUnsubscribe = null;
  }
  if (!sellerId) return;

  try {
    const { db, collection, query, where, onSnapshot } = await getFsModules();
    const q = query(collection(db, "reviews"), where("toId", "==", sellerId));
    _sellerReviewsUnsubscribe = onSnapshot(q, function(snap) {
      // If the reviews modal is currently showing this seller's reviews, refresh it
      const modalOpen = document.getElementById("reviewsModal").classList.contains("show");
      if (!modalOpen) return;

      const titleEl = document.getElementById("reviewsModalTitle");
      if (!titleEl) return;
      // Don't overwrite if it's showing "My Reviews"
      if (titleEl.textContent === "⭐ My Reviews") return;

      // Re-render the reviews list
      const listDiv = document.getElementById("reviewsList");
      const noRevs = document.getElementById("noReviews");
      if (!listDiv || !noRevs) return;

      const reviews = [];
      snap.forEach(function(d) {
        const r = d.data();
        if (r.role === "seller") reviews.push(r);
      });

      reviews.sort(function(a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

      listDiv.innerHTML = "";

      if (reviews.length === 0) {
        noRevs.style.display = "block";
        return;
      }

      noRevs.style.display = "none";

      (async function () {
  for (const r of reviews) {
    await appendReviewCard(listDiv, r, "seller");
  }
})();
    }, function(err) {
      console.warn("Seller reviews subscription error:", err);
    });
  } catch (err) {
    console.warn("Could not subscribe to seller reviews:", err);
  }
}

// Unsubscribe when modal closes
function unsubscribeFromSellerReviews() {
  if (_sellerReviewsUnsubscribe) {
    try { _sellerReviewsUnsubscribe(); } catch (e) {}
    _sellerReviewsUnsubscribe = null;
  }
}
// ============================================
// BROWSE PAGE — all listings with filters + sort
// ============================================
function openBrowsePage() {
  const page = document.getElementById("browsePage");
  if (!page) return;
  page.style.display = "flex";

  // Show skeleton placeholders while the grid fills in
  showBrowseSkeleton();

  applyBrowseFilters();

  // Tell the layer manager we're open
  pushLayer("browsePage", closeBrowsePage);
}

function closeBrowsePage() {
  const page = document.getElementById("browsePage");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("browsePage");
}

// Shows skeleton placeholder cards in the browse grid while loading.
function showBrowseSkeleton() {
  const grid = document.getElementById("browseGrid");
  if (!grid) return;

  let html = "";
  for (let i = 0; i < 6; i++) {
    html +=
      '<div class="listing skeleton-card" aria-hidden="true">' +
        '<div class="skeleton-thumb shimmer"></div>' +
        '<div class="card-body">' +
          '<div class="skeleton-line shimmer" style="width: 90%; height: 12px;"></div>' +
          '<div class="skeleton-line shimmer" style="width: 65%; height: 12px;"></div>' +
          '<div class="skeleton-line shimmer" style="width: 50%; height: 10px; margin-top: 4px;"></div>' +
          '<div class="skeleton-price shimmer" style="width: 45%; height: 16px; margin-top: 6px;"></div>' +
        '</div>' +
      '</div>';
  }
  grid.innerHTML = html;
}

function applyBrowseFilters() {
  const grid = document.getElementById("browseGrid");
  const empty = document.getElementById("browseEmpty");
  const countEl = document.getElementById("browseCount");
  if (!grid || !empty) return;

  const searchEl = document.getElementById("browseSearchInput");
  const conditionEl = document.getElementById("browseCondition");
  const sortEl = document.getElementById("browseSort");
  const minEl = document.getElementById("browseMinPrice");
  const maxEl = document.getElementById("browseMaxPrice");

  const query = searchEl ? (searchEl.value || "").toLowerCase().trim() : "";
  const condition = conditionEl ? (conditionEl.value || "").toLowerCase().trim() : "";
  const sort = sortEl ? (sortEl.value || "newest") : "newest";
  const minPrice = minEl ? (Number(minEl.value) || 0) : 0;
  const maxPrice = maxEl && maxEl.value !== "" ? Number(maxEl.value) : Infinity;

  // Show/hide the clear (✕) button
  const clearBtn = document.getElementById("browseSearchClear");
  if (clearBtn) clearBtn.style.display = query ? "flex" : "none";

  // Start from the full cache, exclude sold and hidden
let items = allListingsCache.filter(function(item) {
  return !item.sold && !item.hidden;
});

  // Exclude sellers I've blocked
  items = filterOutBlockedSellers(items);

  // Text search across name, location, category, and sub-category
if (query) {
  items = items.filter(function(item) {
    const name = (item.name || "").toLowerCase();
    const loc = (item.location || "").toLowerCase();
    const cat = (item.category || "").toLowerCase();
    const subCat = (item.subCategory || "").toLowerCase();
    return name.includes(query) || loc.includes(query) || cat.includes(query) || subCat.includes(query);
  });
}

  // Condition filter
  if (condition) {
    items = items.filter(function(item) {
      return (item.condition || "").toLowerCase() === condition;
    });
  }

  // Price filter
  items = items.filter(function(item) {
    const p = Number(item.price) || 0;
    return p >= minPrice && p <= maxPrice;
  });

  // Sort
  if (sort === "priceLow") {
    items.sort(function(a, b) { return (Number(a.price) || 0) - (Number(b.price) || 0); });
  } else if (sort === "priceHigh") {
    items.sort(function(a, b) { return (Number(b.price) || 0) - (Number(a.price) || 0); });
  } else {
    items.sort(function(a, b) {
  // 1. Promoted items (that haven't expired) float to the top
const aPromo = a.isPromoted && (!a.promotedExpiresAt || a.promotedExpiresAt > Date.now());
const bPromo = b.isPromoted && (!b.promotedExpiresAt || b.promotedExpiresAt > Date.now());

if (aPromo && !bPromo) return -1;
if (!aPromo && bPromo) return 1;
  
  // 2. If both are promoted (or both normal), sort by newest
  const aT = a.postedAt || Number(a.id) || 0;
  const bT = b.postedAt || Number(b.id) || 0;
  return bT - aT;
});
  }

  // Render
  grid.innerHTML = "";

  if (countEl) {
    countEl.textContent = items.length + " listing" + (items.length === 1 ? "" : "s");
  }

  if (items.length === 0) {
  empty.innerHTML =
    '<div style="font-size:44px;margin-bottom:12px;opacity:0.5;">🔎</div>' +
    '<div style="font-weight:700;color:var(--text-dark);margin-bottom:6px;">No listings match your filters</div>' +
    '<div style="color:var(--text-gray);font-size:13px;margin-bottom:16px;">Try adjusting your search, condition, or price range.</div>' +
    '<button class="shop-empty-btn" onclick="clearBrowseFilters()">Clear filters</button>';
  empty.style.display = "block";
  return;
}

  empty.style.display = "none";

  items.forEach(function(item) {
    let realIndex = allListingsCache.findIndex(function(l) { return l.id === item.id; });
    if (realIndex === -1) {
      allListingsCache.push(item);
      realIndex = allListingsCache.length - 1;
    }
    grid.appendChild(createCard(item, realIndex));
  });
}

// Clear the browse search box and reset the grid
function clearBrowseSearch() {
  const input = document.getElementById("browseSearchInput");
  if (input) {
    input.value = "";
    input.focus();
  }
  applyBrowseFilters();
}

// Clear ALL browse filters + search, then re-apply
function clearBrowseFilters() {
  const search = document.getElementById("browseSearchInput");
  const condition = document.getElementById("browseCondition");
  const sort = document.getElementById("browseSort");
  const minEl = document.getElementById("browseMinPrice");
  const maxEl = document.getElementById("browseMaxPrice");

  if (search) search.value = "";
  if (condition) condition.value = "";
  if (sort) sort.value = "newest";
  if (minEl) minEl.value = "";
  if (maxEl) maxEl.value = "";

  applyBrowseFilters();
}

// ============================================
// LAST LOCATION — session restore
// ============================================
// Saves where the user was, so a page refresh can
// bring them back to the same screen.
//
// Format: { layer: "detailModal", data: {...}, timestamp: 1730000000000 }
//
// - Expires after 30 minutes (stale data, safer fallback)
// - Cleared whenever the user lands on the homepage

const LAST_LOCATION_KEY = "marketaLastLocation";
const LAST_LOCATION_MAX_AGE_MS = 30 * 60 * 1000;  // 30 minutes

// Saves the current location. Call whenever a restorable
// layer is opened.
function saveLastLocation(layerId, data) {
  if (!layerId) return;
  try {
    const payload = {
      layer: layerId,
      data: data || {},
      timestamp: Date.now()
    };
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(payload));
  } catch (e) {
    // ignore — quota exceeded, etc.
  }
}

// Reads the saved location. Returns null if none exists
// or if it's older than the max age.
function loadLastLocation() {
  try {
    const raw = localStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.layer) return null;

    const age = Date.now() - (parsed.timestamp || 0);
    if (age > LAST_LOCATION_MAX_AGE_MS) {
      // Too old — clean it up and forget
      localStorage.removeItem(LAST_LOCATION_KEY);
      return null;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

// ============================================
// RESTORE OVERLAY — visual cue on refresh
// ============================================
// Shown briefly during the "reopen last screen on refresh"
// flow. Hidden when restore finishes (success or fail).
// Never appears on a fresh launch — only when wasReload()
// is true.

function showRestoreOverlay() {
  const el = document.getElementById("restoreOverlay");
  if (el) el.style.display = "flex";
}

function hideRestoreOverlay() {
  const el = document.getElementById("restoreOverlay");
  if (el) el.style.display = "none";
}

// Hides the homepage <main> while we're restoring a screen
// on refresh — so the user doesn't see Home flash before
// their restored screen appears.
function hideHomeForRestore() {
  document.body.classList.add("restoring-screen");
}

// Reveals the homepage again (after a successful restore
// the restored screen covers it anyway; after a failed
// restore, this is how the user ends up back on Home).
function showHomeAfterRestore() {
  document.body.classList.remove("restoring-screen");
}

// Returns true only if the current page load is a real
// in-tab refresh (F5 / pull-down / ⟳) — NOT a fresh launch
// from the app icon, a new tab, or a back-forward navigation.
function wasReload() {
  try {
    const entries = performance.getEntriesByType("navigation");
    if (entries && entries.length > 0) {
      return entries[0].type === "reload";
    }
    // Legacy fallback for very old browsers
    if (performance.navigation) {
      return performance.navigation.type === 1; // 1 = TYPE_RELOAD
    }
  } catch (e) {
    // If anything goes wrong, don't restore — safer.
  }
  return false;
}


// Wipes the saved location. Called when the user lands on
// home, or when a restore fails.
function clearLastLocation() {
  try {
    localStorage.removeItem(LAST_LOCATION_KEY);
  } catch (e) {
    // ignore
  }
}

// ============================================
// CHAT TYPING — input listener (attached once)
// ============================================
// Wires up the chat input so we know when the user is typing.
// Runs once at page load. Safe to call repeatedly.
function attachTypingListener() {
  const input = document.getElementById("threadInput");
  if (!input) return;
  if (input.dataset.typingWired === "yes") return;
  input.dataset.typingWired = "yes";

  // Fire signalTyping() on every keystroke
  input.addEventListener("input", function () {
    signalTyping();
  });

  // Also clear typing when the user submits via Enter (if we
  // ever add Enter-to-send). For now, no-op if not used.
}

// Try to attach now, and again on DOM ready (in case the app
// is still loading the HTML when this script runs).
attachTypingListener();
window.addEventListener("load", attachTypingListener);

// ============================================
// LAYER MANAGER — clean and simple
// ============================================
// - Every overlay (page, modal, dialog) is a "layer"
// - Opening a new layer pushes it onto the stack (on top)
// - Closing the top layer pops it
// - Back button closes the top layer
// - ✕ buttons close only their own layer
// ============================================
let _layerStack = [];
let _exitWarnShown = false;
let _exitWarnTimer = null;
let _closingFromCode = false;

// Open a new layer on top of the stack.
function pushLayer(id, closeFn) {
  // If this exact layer is already open, treat as a no-op
  // (avoid stacking the same dialog twice)
  const existing = _layerStack.find(function(l) { return l.id === id; });
  if (existing) {
    // Already open — just update the close function reference
    existing.close = closeFn;
    return;
  }

  _layerStack.push({ id: id, close: closeFn });
  
  // Save this layer as the last location, so a real in-tab
// refresh can restore it. We only save layers that are
// safe to restore (see RESTORABLE_LAYERS below).
//
// IMPORTANT: don't overwrite if the caller has already
// saved a more detailed location (with data) for the same
// layer. This lets pages like checkout and detail save
// their itemId and keep it.
if (RESTORABLE_LAYERS[id]) {
  const current = loadLastLocation();
  const alreadySaved = current && current.layer === id;
  if (!alreadySaved) {
    saveLastLocation(id, {});
  }
}

  // Push a browser history entry so the back button has
  // something to pop.
  try {
    history.pushState(
      { marketaLayer: id },
      "",
      "#layer-" + id + "-" + Date.now()
    );
  } catch (e) {
    // Ignore — some browsers restrict pushState
  }
}

// The list of layers we know how to restore after a
// refresh. Anything not in this map is left alone
// (dismissed on refresh, like a normal modal).
//
// Key = layer id, value = true.
// We'll add "detailModal" / "threadModal" / "checkoutPage"
// in later steps when their restore logic is ready.
const RESTORABLE_LAYERS = {
  profilePage: true,
  messagesModal: true,
  listingsModal: true,
  shopModal: true,
  dashboardPage: true,
  myTicketsPage: true,
  ticketDetailPage: true,
  ordersModal: true,
  wishlistPage: true,
  settingsPage: true,
  moderationPage: true,
  browsePage: true,
  searchPage: true,
  followersPage: true,
  followingPage: true,
  userListingsPage: true,
  legalPage: true,
  threadModal: true,
  detailModal: true,
  checkoutPage: true
};

// Close a specific layer (by id) or the top layer (no id).
function popLayer(id, silent) {
  if (_layerStack.length === 0) return;

  let removed;
  if (id) {
    // Remove the named layer wherever it is in the stack
    const idx = _layerStack.map(function(l) { return l.id; }).lastIndexOf(id);
    if (idx === -1) return;
    removed = _layerStack.splice(idx, 1)[0];
  } else {
    removed = _layerStack.pop();
  }

  // Whenever the last layer closes, we're effectively on the
  // homepage — forget the saved location so a future refresh
  // doesn't reopen a page that's already closed.
  if (_layerStack.length === 0) {
    clearLastLocation();
  }

  // If we're not already inside a popstate handler (i.e.
  // the user tapped ✕), consume the history entry that
  // pushLayer added for this layer.
  if (silent === true) return;
  if (_closingFromCode) return;

  try {
    if (history.state && history.state.marketaLayer) {
      _closingFromCode = true;
      history.back();
      setTimeout(function() { _closingFromCode = false; }, 100);
    }
  } catch (e) {
    // Ignore
  }
}

// Return the top layer (or null).
function topLayer() {
  return _layerStack.length > 0 ? _layerStack[_layerStack.length - 1] : null;
}

// Is any layer currently open?
function hasOpenLayer() {
  return _layerStack.length > 0;
}

// ============================================
// BACK BUTTON HANDLER
// ============================================
window.addEventListener("popstate", function () {
  // If we triggered this popstate from our own ✕
  // handler, don't do anything (the layer is already gone).
  if (_closingFromCode) return;

  // A layer is open → close the top one.
if (_layerStack.length > 0) {
  _closingFromCode = true;

  const top = _layerStack[_layerStack.length - 1];
  try {
    const closeFn = top.close;
    _layerStack.pop();
    if (typeof closeFn === "function") closeFn();
  } catch (e) {
    console.warn("Error closing layer:", e);
  }

  // If that was the LAST layer, we're now on Home —
  // forget the saved location.
  if (_layerStack.length === 0) {
    clearLastLocation();
  }

  setTimeout(function() { _closingFromCode = false; }, 100);
  return;
}

  // No layer open → we're at the homepage.
  if (_exitWarnShown) {
    if (_exitWarnTimer) {
      clearTimeout(_exitWarnTimer);
      _exitWarnTimer = null;
    }
    _exitWarnShown = false;
    return;
  }

  _exitWarnShown = true;
  marketaToast("Tap back again to exit");

  try { history.pushState({ marketaBase: true }, ""); } catch (e) {}

  if (_exitWarnTimer) clearTimeout(_exitWarnTimer);
  _exitWarnTimer = setTimeout(function () {
    _exitWarnShown = false;
    _exitWarnTimer = null;
  }, 2000);
});

// Install a baseline history entry at startup.
history.pushState({ marketaBase: true }, "");
// ============================================
// RESTORE LAST LOCATION — on page load
// ============================================
// After auth + listings are ready, check if we have a
// saved location and reopen it. Runs once per page load.
//
// Walks through a whitelist of "restorable" layers. Each
// entry has a "canRestore" check and an "open" action.
// If anything fails, we silently fall through to the
// homepage — no error shown.
let _restoreAttempted = false;

async function restoreLastLocation() {
  // Only try once per page load
  if (_restoreAttempted) return;
  _restoreAttempted = true;

  const saved = loadLastLocation();
  if (!saved) {
    // Nothing to restore — make sure we're not leaving
    // the overlay up from a previous partial run.
    hideRestoreOverlay();
    showHomeAfterRestore();
    return;
  }

  const layerId = saved.layer;

  // Ensure we have a user for pages that need one
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);

  // Pages that require a logged-in user
  const needsLogin = [
    "profilePage",
    "messagesModal",
    "listingsModal",
    "shopModal",
    "myTicketsPage",
    "ticketDetailPage",
    "dashboardPage",
    "ordersModal",
    "wishlistPage",
    "settingsPage",
    "moderationPage",
    "followersPage",
    "followingPage"
  ];

  if (needsLogin.indexOf(layerId) !== -1 && !user) {
    // No user signed in — can't restore these pages
    hideRestoreOverlay();
    showHomeAfterRestore();
    clearLastLocation();
    return;
  }

  // Give Firebase subscriptions a moment to finish populating
  await new Promise(function (resolve) { setTimeout(resolve, 600); });

  try {
    switch (layerId) {
      case "profilePage":
        await openProfile();
        break;
      case "messagesModal":
        await openMessages();
        break;
      case "listingsModal":
        await openMyListings();
        break;
      case "shopModal":
        await openShop();
        break;
      case "dashboardPage":
        await openDashboard();
        break;
      case "myTicketsPage":
        await openMyTickets();
        break;
        case "ticketDetailPage":
  if (saved.data && saved.data.ticketId) {
    // Load tickets first so the cache is warm.
    // If it was opened in admin mode, load all tickets too.
    if (saved.data.admin) {
      await loadModTickets();
    }
    await loadMyTickets();
    // Merge any missing tickets from the admin cache
    if (saved.data.admin && _modTicketsCache && _modTicketsCache.length) {
      _modTicketsCache.forEach(function (t) {
        if (!_myTicketsCache.find(function (x) { return x._docId === t._docId; })) {
          _myTicketsCache.push(t);
        }
      });
    }
    await openTicketDetail(saved.data.ticketId, { admin: !!saved.data.admin });
  } else {
    hideRestoreOverlay();
    showHomeAfterRestore();
    clearLastLocation();
  }
  break;
      case "ordersModal":
        await openOrders();
        break;
      case "wishlistPage":
        await openWishlistPage();
        break;
      case "settingsPage":
        openSettings();
        break;
      case "moderationPage":
        await openModeration();
        break;
      case "browsePage":
        openBrowsePage();
        break;
      case "searchPage":
        openSearchPage();
        break;
      case "followersPage":
        await openFollowersPage();
        break;
      case "followingPage":
        await openFollowingPage();
        break;
      case "threadModal":
        await restoreThreadFromSaved(saved.data);
        break;
      case "detailModal":
        await restoreDetailFromSaved(saved.data);
        break;
      case "checkoutPage":
        await restoreCheckoutFromSaved(saved.data);
        break;
      case "userListingsPage":
        if (saved.data && saved.data.uid) {
          await openUserListingsPage(saved.data.uid, saved.data.name || "Listings");
        } else {
          hideRestoreOverlay();
          showHomeAfterRestore();
          clearLastLocation();
        }
        break;
      case "legalPage":
        if (saved.data && saved.data.key) {
          openLegalDoc(saved.data.key);
        } else {
          hideRestoreOverlay();
          showHomeAfterRestore();
          clearLastLocation();
        }
        break;
      default:
        // Unknown layer — silently ignore
        hideRestoreOverlay();
        showHomeAfterRestore();
        clearLastLocation();
        return;
    }

    // The restore target is now open. Hide the overlay,
    // and reveal Home underneath (the restored screen
    // covers it — so Home is never seen in the meantime).
    hideRestoreOverlay();
    showHomeAfterRestore();

  } catch (err) {
    // Restore failed silently — fall back to homepage
    console.warn("Could not restore last location:", err);
    hideRestoreOverlay();
    showHomeAfterRestore();
    clearLastLocation();
  }
}

// Reopens the saved checkout page, if the listing still
// exists and the user is still signed in.
//
// Note: the checkout form fields (address, note, delivery
// mode) are NOT restored — they reset to defaults.
async function restoreCheckoutFromSaved(data) {
  if (!data || !data.itemId) {
    clearLastLocation();
    return;
  }

  // Checkout requires a signed-in user
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) {
    clearLastLocation();
    return;
  }

  // Ensure listings are fresh
  await loadListingsFromFirestore().catch(function () {});

  const realIndex = allListingsCache.findIndex(function (l) {
    return l.id === data.itemId;
  });

  if (realIndex < 0) {
    marketaToast("That listing is no longer available");
    clearLastLocation();
    return;
  }

  const item = allListingsCache[realIndex];
  const myUid = user.uid;

  // Can't buy your own listing
  if (item.sellerId === myUid) {
    clearLastLocation();
    return;
  }

  // Hidden or sold — fall back
  if (item.hidden || item.sold) {
    marketaToast("That listing is no longer available");
    clearLastLocation();
    return;
  }

  // Set the context and open
  currentItemIndex = realIndex;
  openCheckout();
}

// Reopens the saved listing detail, if it still exists
// and is visible to the current user.
async function restoreDetailFromSaved(data) {
  if (!data || !data.itemId) {
    clearLastLocation();
    return;
  }

  // Ensure listings are fresh
  await loadListingsFromFirestore().catch(function () {});

  const realIndex = allListingsCache.findIndex(function (l) {
    return l.id === data.itemId;
  });

  if (realIndex < 0) {
    marketaToast("That listing is no longer available");
    clearLastLocation();
    return;
  }

  const item = allListingsCache[realIndex];

  // If it's hidden or sold, only the owner/admin should see it.
  // For everyone else, drop back to home.
  const myUid = (currentAuthUser && currentAuthUser.uid) || currentUserId || null;
  const isOwner = myUid && item.sellerId === myUid;

  if (item.hidden && !isOwner) {
    marketaToast("That listing is no longer available");
    clearLastLocation();
    return;
  }

  if (item.sold && !isOwner) {
    marketaToast("That listing has been sold");
    clearLastLocation();
    return;
  }

  // Open it
  showDetail(realIndex);
}

// Reopens the saved chat (either a dispute thread or a
// buyer↔seller thread).
async function restoreThreadFromSaved(data) {
  if (!data) {
    clearLastLocation();
    return;
  }

  // ----- Dispute thread (order-based) -----
  if (data.mode === "dispute") {
    if (!data.ref) {
      clearLastLocation();
      return;
    }

    // Ensure orders are fresh
    await loadOrdersFromFirestore().catch(function () {});

    const order = allOrdersCache.find(function (o) { return o.ref === data.ref; });
    if (!order) {
      // Order gone — nothing to restore
      marketaToast("That order is no longer available");
      clearLastLocation();
      return;
    }

    await openThread(data.ref, data.role || "buyer");
    return;
  }

  // ----- Buyer ↔ Seller thread (chat) -----
  if (data.mode === "bs") {
    if (!data.threadId) {
      clearLastLocation();
      return;
    }

    // Ensure threads are fresh
    await loadThreadsFromFirestore().catch(function () {});

    const thread = allThreadsCache.find(function (t) { return t.id === data.threadId; });
    if (!thread) {
      marketaToast("That chat is no longer available");
      clearLastLocation();
      return;
    }

    openBuyerSellerThread(thread);
    return;
  }

  // Unknown mode — bail
  clearLastLocation();
}

// ============================================
// SETTINGS PAGE
// ============================================
function openSettings() {
  const page = document.getElementById("settingsPage");
  if (!page) return;

  page.style.display = "flex";
  document.body.classList.add("page-open");

  // Sync the notification row so it reflects the real permission state
  if (typeof updateNotificationRow === "function") {
    updateNotificationRow();
  }

  // Tell the layer manager we're open
  pushLayer("settingsPage", closeSettings);
  
  // Hide account-specific rows when logged out
const fb = window.marketaFirebase;
const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
const loggedIn = !!user;

const accountRow = document.getElementById("settingsRowAccount");
const passwordRow = document.getElementById("settingsRowPassword");
const deleteRow = document.getElementById("settingsRowDelete");

if (accountRow) accountRow.style.display = loggedIn ? "" : "none";
if (passwordRow) passwordRow.style.display = loggedIn ? "" : "none";
if (deleteRow) deleteRow.style.display = loggedIn ? "" : "none";
}

function closeSettings() {
  const page = document.getElementById("settingsPage");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("settingsPage");

  // Only remove "page-open" if no other full-screen page is still open
  if (!hasAnotherPageOpen("settingsPage")) {
    document.body.classList.remove("page-open");
  }
}

// ============================================
// INITIALISE THEME + APPEARANCE ROW
// ============================================
window.addEventListener("firebase-ready", function() {
  try { initTheme(); } catch (e) { console.warn("initTheme failed:", e); }
  setTimeout(updateAppearanceRow, 300);
  setTimeout(updateAccountRow, 400);
  setTimeout(updateNotificationRow, 500);

  // Ask about notifications if this user hasn't been asked yet
  setTimeout(function () {
    const fb = window.marketaFirebase;
    const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
    if (user && typeof showNotifAskDialog === "function") {
      showNotifAskDialog();
    }
  }, 0);
});

// Re-sync the notification row whenever the app regains focus.
// Covers the case: user changes permission in browser settings,
// comes back to the app.
window.addEventListener("focus", function () {
  if (typeof updateNotificationRow === "function") {
    updateNotificationRow();
  }
});

window.addEventListener("load", function() {
  setTimeout(function() {
    try { updateAppearanceRow(); } catch (e) {}
    try { updateAccountRow(); } catch (e) {}
  }, 500);
});

// ============================================
// ACCOUNT SETTINGS — edit display name
// ============================================
function openAccountSettings() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  const modal = document.getElementById("accountSettingsModal");
  const emailEl = document.getElementById("accountEmail");
  const nameInput = document.getElementById("accountNameInput");
  const errEl = document.getElementById("accountError");

  if (emailEl) emailEl.textContent = user.email || "—";
if (nameInput) {
  nameInput.value = user.displayName
    || (user.email ? user.email.split("@")[0] : "");
}
if (errEl) errEl.style.display = "none";

// Load the phone number from Firestore
const phoneInput = document.getElementById("accountPhoneInput");
if (phoneInput) phoneInput.value = "";
loadAccountPhone(user.uid);
loadAccountLocation(user.uid);
loadAccountBioAndWebsite(user.uid);

  modal.classList.add("show");
  pushLayer("accountSettingsModal", closeAccountSettings);
}

function closeAccountSettings() {
  const modal = document.getElementById("accountSettingsModal");
  if (!modal) return;
  modal.classList.remove("show");
  popLayer("accountSettingsModal");
}

async function saveAccountName() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  const nameInput = document.getElementById("accountNameInput");
  const errEl = document.getElementById("accountError");
  const newName = (nameInput.value || "").trim();

  errEl.style.display = "none";

  if (!newName) {
    errEl.textContent = "Please enter a name.";
    errEl.style.display = "block";
    return;
  }
  if (newName.length < 2) {
    errEl.textContent = "Name must be at least 2 characters.";
    errEl.style.display = "block";
    return;
  }
  if (newName.length > 40) {
    errEl.textContent = "Name can't be longer than 40 characters.";
    errEl.style.display = "block";
    return;
  }

  try {
    const mod = await getAuthModule();
    await mod.updateProfile(user, { displayName: newName });

    // Read the phone number
const phoneInput = document.getElementById("accountPhoneInput");
const rawPhone = phoneInput ? phoneInput.value.trim() : "";

// If they entered one, validate it
let cleanPhone = "";
if (rawPhone) {
  const check = validateGhanaPhone(rawPhone);
  if (!check.ok) {
    errEl.textContent = check.msg;
    errEl.style.display = "block";
    return;
  }
  cleanPhone = check.cleaned;
}

const { db, doc, setDoc } = await getFsModules();

const loc = readAccountLocation();

// Read bio + website
const bioInput = document.getElementById("accountBioInput");
const websiteInput = document.getElementById("accountWebsiteInput");
const bio = bioInput ? (bioInput.value || "").trim() : "";
const website = websiteInput ? (websiteInput.value || "").trim() : "";

await setDoc(
  doc(db, "users", user.uid),
  {
    displayName: newName,
    phone: cleanPhone,
    locationArea: loc.area,
    locationRegion: loc.region,
    bio: bio,
    website: website,
    updatedAt: Date.now()
  },
  { merge: true }
);

    if (typeof _userNameCache === "object" && _userNameCache !== null) {
      _userNameCache[user.uid] = newName;
    }

    if (currentAuthUser) {
      try {
        currentAuthUser.displayName = newName;
      } catch (e) {
        currentAuthUser = Object.assign(
          Object.create(Object.getPrototypeOf(currentAuthUser)),
          currentAuthUser,
          { displayName: newName }
        );
      }
    }

    const profileNameEl = document.getElementById("profileDisplayName");
    if (profileNameEl) profileNameEl.textContent = newName;

    const profileAvatarEl = document.getElementById("profileAvatar");
    if (profileAvatarEl) {
      profileAvatarEl.textContent = newName.charAt(0).toUpperCase();
    }

    loadProfileStats(user.uid).catch(function(e) { console.warn(e); });
    updateAccountRow();
    updateHeaderAuth();

    marketaToast("Account updated ✅");
    closeAccountSettings();

  } catch (err) {
    errEl.textContent = "Couldn't save: " + (err.message || "unknown error");
    errEl.style.display = "block";
  }
}

function updateAccountRow() {
  const subEl = document.getElementById("accountNameSub");
  if (!subEl) return;
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);

  if (user) {
    const name = user.displayName
      || (user.email ? user.email.split("@")[0] : "Your name");
    subEl.textContent = name;
    return;
  }

  // No user yet. If Firebase Auth hasn't answered yet, leave the
  // subtext empty — showing "Sign in to edit" too early is wrong.
  if (!_authReady) {
    subEl.textContent = "";
    // Try again shortly, once Firebase has had time to answer
    if (!updateAccountRow._retryTimer) {
      updateAccountRow._retryTimer = setTimeout(function () {
        updateAccountRow._retryTimer = null;
        updateAccountRow();
      }, 800);
    }
    return;
  }

  // Firebase has confirmed — the user really is signed out
  subEl.textContent = "Sign in to edit";
}

// ============================================
// PAGE-OPEN HELPER
// ============================================
function hasAnotherPageOpen(excludeId) {
  var pageIds = ["profilePage", "settingsPage"];
  for (var i = 0; i < pageIds.length; i++) {
    var id = pageIds[i];
    if (id === excludeId) continue;
    if (_layerStack.some(function(l) { return l.id === id; })) {
      return true;
    }
  }
  return false;
}

// ============================================
// PASSWORD SETTINGS
// ============================================
function openPasswordSettings() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  const modal = document.getElementById("passwordSettingsModal");
  if (!modal) return;

  const cur = document.getElementById("pwdCurrent");
  const nw = document.getElementById("pwdNew");
  const cf = document.getElementById("pwdConfirm");
  const errEl = document.getElementById("pwdError");
  if (cur) cur.value = "";
  if (nw) nw.value = "";
  if (cf) cf.value = "";
  if (errEl) errEl.style.display = "none";

  modal.classList.add("show");
  pushLayer("passwordSettingsModal", closePasswordSettings);
}

function closePasswordSettings() {
  const modal = document.getElementById("passwordSettingsModal");
  if (!modal) return;
  modal.classList.remove("show");
  popLayer("passwordSettingsModal");
}

async function saveNewPassword() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  const curEl = document.getElementById("pwdCurrent");
  const nwEl = document.getElementById("pwdNew");
  const cfEl = document.getElementById("pwdConfirm");
  const errEl = document.getElementById("pwdError");

  const currentPwd = (curEl.value || "").trim();
  const newPwd = (nwEl.value || "").trim();
  const confirmPwd = (cfEl.value || "").trim();

  errEl.style.display = "none";

  if (!currentPwd || !newPwd || !confirmPwd) {
    errEl.textContent = "Please fill in all three fields.";
    errEl.style.display = "block";
    return;
  }
  if (newPwd.length < 6) {
    errEl.textContent = "New password must be at least 6 characters.";
    errEl.style.display = "block";
    return;
  }
  if (newPwd !== confirmPwd) {
    errEl.textContent = "New passwords don't match.";
    errEl.style.display = "block";
    return;
  }
  if (newPwd === currentPwd) {
    errEl.textContent = "New password must be different from the current one.";
    errEl.style.display = "block";
    return;
  }

  try {
    const mod = await getAuthModule();
    const credential = mod.EmailAuthProvider.credential(user.email, currentPwd);
    await mod.reauthenticateWithCredential(user, credential);
    await mod.updatePassword(user, newPwd);

    marketaToast("Password updated 🔒");
    closePasswordSettings();

  } catch (err) {
    const code = err.code || "";
    let msg = err.message || "Could not update password.";
    if (code.includes("wrong-password") || code.includes("invalid-credential")) {
      msg = "Current password is incorrect.";
    } else if (code.includes("weak-password")) {
      msg = "New password is too weak. Use at least 6 characters.";
    } else if (code.includes("requires-recent-login")) {
      msg = "Please log out and log back in, then try again.";
    } else if (code.includes("too-many-requests")) {
      msg = "Too many attempts. Please wait a few minutes.";
    } else if (code.includes("network-request-failed")) {
      msg = "Network error. Check your connection.";
    }
    errEl.textContent = msg;
    errEl.style.display = "block";
  }
}

// ============================================
// NOTIFICATIONS — post-signup ask dialog
// ============================================

// Shows the "Stay in the loop" dialog.
// Called right after signup or the first login on a device.
function showNotifAskDialog() {
  // Don't ask if we already have permission
  if (!notificationsSupported()) return;
  if (Notification.permission === "granted") return;
  if (Notification.permission === "denied") return;
  if (hasBeenAskedForNotifications()) return;

  const modal = document.getElementById("notifAskModal");
  if (!modal) return;

  modal.classList.add("show");
  pushLayer("notifAskModal", dismissNotifAsk);
}

// User tapped "Turn on notifications"
async function acceptNotifAsk() {
  markNotificationsAsked();

  const modal = document.getElementById("notifAskModal");
  if (modal) modal.classList.remove("show");
  popLayer("notifAskModal");

  // Trigger the browser prompt
  await requestNotificationPermission();

  // Always re-read the truth from the browser — permission may
  // have been granted, denied, or dismissed, and we want the
  // app state to match reality, not our assumption.
  if (Notification.permission === "granted") {
    setNotificationsMuted(false);
    marketaToast("Notifications on 🔔");
  } else if (Notification.permission === "denied") {
    marketaToast("Notifications blocked by browser");
  } else {
    marketaToast("Notifications not enabled");
  }

  // Refresh the settings row regardless
  updateNotificationRow();
}

// User tapped "Not now" or closed the dialog
function dismissNotifAsk() {
  markNotificationsAsked();

  const modal = document.getElementById("notifAskModal");
  if (modal) modal.classList.remove("show");
  popLayer("notifAskModal");

  updateNotificationRow();
}

// ============================================
// RATING SUMMARY MODAL
// ============================================

// The currently viewed user's reviews (for the summary).
// null = viewing your own; "uid" = someone else's (future).
let _ratingSummaryTargetUid = null;

// Opens the rating summary modal.
// targetUid defaults to your own uid.
// name defaults to "your rating" in the subtitle context.
async function openRatingSummary(targetUid, displayName) {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  // Default to yourself
  _ratingSummaryTargetUid = targetUid || user.uid;
  const isOwn = (_ratingSummaryTargetUid === user.uid);

  // Title + breadcrumb
  const titleEl = document.querySelector("#ratingSummaryModal .modal-header h2");
  if (titleEl) {
    titleEl.textContent = isOwn ? "⭐ Your rating" : "⭐ " + (displayName || "Seller") + "'s rating";
  }

  // Reset the UI to "loading"
  const avgEl = document.getElementById("ratingSummaryAvg");
  const starsEl = document.getElementById("ratingSummaryStars");
  const countEl = document.getElementById("ratingSummaryCount");
  const distEl = document.getElementById("ratingSummaryDist");
  const emptyEl = document.getElementById("ratingSummaryEmpty");
  const seeAllBtn = document.getElementById("ratingSummarySeeAll");

  if (avgEl) avgEl.textContent = "…";
  if (starsEl) starsEl.textContent = "☆☆☆☆☆";
  if (countEl) countEl.textContent = "Loading…";
  if (distEl) distEl.innerHTML = "";
  if (emptyEl) emptyEl.style.display = "none";
  if (seeAllBtn) seeAllBtn.style.display = "none";

  // Show the modal + register with the layer manager
  document.getElementById("ratingSummaryModal").classList.add("show");
  pushLayer("ratingSummaryModal", closeRatingSummary);

  // Fetch + compute
  try {
    const { db, collection, query, where, getDocs } = await getFsModules();
    const q = query(collection(db, "reviews"), where("toId", "==", _ratingSummaryTargetUid));
    const snap = await getDocs(q);

    // Only count reviews where role === "seller" (i.e. ratings
    // this person received as a seller). Same logic as the
    // seller-rating line on the detail page.
    const buckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let count = 0;

    snap.forEach(function (d) {
      const r = d.data();
      if (r.role !== "seller") return;
      if (typeof r.stars !== "number") return;
      const s = Math.round(r.stars);
      if (s < 1 || s > 5) return;
      buckets[s] = (buckets[s] || 0) + 1;
      total += s;
      count += 1;
    });

    renderRatingSummary(buckets, total, count);
  } catch (err) {
    console.warn("Rating summary load failed:", err);
    if (avgEl) avgEl.textContent = "—";
    if (starsEl) starsEl.textContent = "☆☆☆☆☆";
    if (countEl) countEl.textContent = "Couldn't load";
  }
}

// Renders the summary from pre-computed data.
function renderRatingSummary(buckets, total, count) {
  const avgEl = document.getElementById("ratingSummaryAvg");
  const starsEl = document.getElementById("ratingSummaryStars");
  const countEl = document.getElementById("ratingSummaryCount");
  const distEl = document.getElementById("ratingSummaryDist");
  const emptyEl = document.getElementById("ratingSummaryEmpty");
  const seeAllBtn = document.getElementById("ratingSummarySeeAll");

  // Empty state
  if (count === 0) {
    if (avgEl) avgEl.textContent = "—";
    if (starsEl) starsEl.textContent = "☆☆☆☆☆";
    if (countEl) countEl.textContent = "No reviews yet";
    if (distEl) distEl.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "block";
    if (seeAllBtn) seeAllBtn.style.display = "none";
    return;
  }

  const avg = total / count;

  // ----- Big number -----
  if (avgEl) avgEl.textContent = avg.toFixed(1);

  // ----- Star visualization -----
  // Round to the nearest half for display purposes.
  // (Full star / half star would need a special character —
  //  we'll use a simple floor + fallback to full stars.)
  const rounded = Math.round(avg);
  const filled = Math.max(0, Math.min(5, rounded));
  const empty = 5 - filled;
  if (starsEl) {
    starsEl.textContent = "★".repeat(filled) + "☆".repeat(empty);
  }

  // ----- Count -----
  if (countEl) {
    countEl.textContent = "Based on " + count + " review" + (count === 1 ? "" : "s");
  }

  // ----- Distribution bars -----
  if (distEl) {
    distEl.innerHTML = "";

    // Largest bucket → 100% bar width reference
    let maxBucket = 1;
    Object.keys(buckets).forEach(function (k) {
      if (buckets[k] > maxBucket) maxBucket = buckets[k];
    });

    // Render 5★ → 1★ top to bottom
    for (let star = 5; star >= 1; star--) {
      const n = buckets[star] || 0;
      const pct = (n / maxBucket) * 100;

      const row = document.createElement("div");
      row.className = "rating-dist-row";

      const label = document.createElement("span");
      label.className = "rating-dist-label";
      label.textContent = star + " star" + (star === 1 ? "" : "s");

      const barWrap = document.createElement("div");
      barWrap.className = "rating-dist-bar-wrap";

      const bar = document.createElement("div");
      bar.className = "rating-dist-bar";
      bar.style.width = pct + "%";
      barWrap.appendChild(bar);

      const count2 = document.createElement("span");
      count2.className = "rating-dist-count";
      count2.textContent = n;

      row.appendChild(label);
      row.appendChild(barWrap);
      row.appendChild(count2);
      distEl.appendChild(row);
    }
  }

  // ----- Show "See all reviews" -----
  if (emptyEl) emptyEl.style.display = "none";
  if (seeAllBtn) seeAllBtn.style.display = "block";
}

// Closes the summary modal.
function closeRatingSummary() {
  const modal = document.getElementById("ratingSummaryModal");
  if (!modal) return;
  modal.classList.remove("show");
  popLayer("ratingSummaryModal");
}

// Handler for the "See all reviews →" button in the summary.
// Closes the summary and opens the reviews list.
function openReviewsFromSummary() {
  const targetUid = _ratingSummaryTargetUid;
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);

  // Close the summary first
  closeRatingSummary();

  // Give the layer stack a moment to settle, then open reviews
  setTimeout(function () {
    if (user && targetUid === user.uid) {
      // Own reviews → the tabbed view
      openMyReviews();
    } else if (targetUid) {
      // Someone else's → the seller-reviews view.
      // (Not yet wired from the UI, but ready.)
      _currentSellerId = targetUid;
      openSellerReviews();
    }
  }, 200);
}

// ============================================
// NOTIFICATIONS — settings dialog
// ============================================

// Opens the notifications dialog.
function openNotificationSettings() {
  const modal = document.getElementById("notificationsModal");
  if (!modal) return;

  refreshNotificationDialog();
  modal.classList.add("show");
  pushLayer("notificationsModal", closeNotificationSettings);
}

function closeNotificationSettings() {
  const modal = document.getElementById("notificationsModal");
  if (!modal) return;
  modal.classList.remove("show");
  popLayer("notificationsModal");
}

// Paints the toggle + hint based on the current state.
function refreshNotificationDialog() {
  const iconEl = document.getElementById("notifToggleIcon");
  const labelEl = document.getElementById("notifToggleLabel");
  const switchEl = document.getElementById("notifToggleSwitch");
  const hintEl = document.getElementById("notifHint");

  const supported = notificationsSupported();
  const permission = getNotificationPermission();
  const muted = isNotificationsMuted();

  // ------- Unsupported browser -------
  if (!supported) {
    if (iconEl) iconEl.textContent = "🚫";
    if (labelEl) labelEl.textContent = "Not supported on this browser";
    if (switchEl) switchEl.classList.remove("on");
    if (hintEl) {
      hintEl.textContent =
        "Your browser doesn't support notifications. Try Chrome on Android or a desktop browser.";
      hintEl.style.display = "block";
    }
    return;
  }

  // ------- Permission denied at browser level -------
  if (permission === "denied") {
    if (iconEl) iconEl.textContent = "🚫";
    if (labelEl) labelEl.textContent = "Blocked by your browser";
    if (switchEl) switchEl.classList.remove("on");
    if (hintEl) {
      hintEl.innerHTML =
        "Notifications are blocked for Marketa. To turn them on, open your browser settings → " +
        "Site settings → Notifications → allow Marketa.";
      hintEl.style.display = "block";
    }
    return;
  }

  // ------- Normal state: toggle reflects `muted` -------
  if (permission === "granted" && !muted) {
    if (iconEl) iconEl.textContent = "🔔";
    if (labelEl) labelEl.textContent = "Notifications are on";
    if (switchEl) switchEl.classList.add("on");
  } else {
    if (iconEl) iconEl.textContent = "🔕";
    if (labelEl) labelEl.textContent = "Turn on notifications";
    if (switchEl) switchEl.classList.remove("on");
  }

  if (hintEl) hintEl.style.display = "none";
}

// User tapped the toggle.
async function toggleNotifications() {
  if (!notificationsSupported()) return;

  const permission = getNotificationPermission();

  // Denied at browser level — show the hint
  if (permission === "denied") {
    refreshNotificationDialog();
    return;
  }

  // If currently ON → turn OFF (mute)
  if (permission === "granted" && !isNotificationsMuted()) {
    setNotificationsMuted(true);
    refreshNotificationDialog();
    updateNotificationRow();
    marketaToast("Notifications muted 🔕");
    return;
  }

  // If currently OFF → request permission (or unmute if already granted)
  if (permission === "granted") {
    setNotificationsMuted(false);
    refreshNotificationDialog();
    updateNotificationRow();
    marketaToast("Notifications on 🔔");
    return;
  }

  // Permission is "default" — ask the browser
  const result = await requestNotificationPermission();
  if (result === "granted") {
    setNotificationsMuted(false);
    markNotificationsAsked();
    refreshNotificationDialog();
    updateNotificationRow();
    marketaToast("Notifications on 🔔");
  } else {
    markNotificationsAsked();
    refreshNotificationDialog();
    updateNotificationRow();
  }
}

// Updates the Settings row subtext ("On" / "Off" / "Blocked").
function updateNotificationRow() {
  const subEl = document.getElementById("notificationsSub");
  if (!subEl) return;

  if (!notificationsSupported()) {
    subEl.textContent = "Not supported";
    return;
  }

  const permission = getNotificationPermission();
  if (permission === "denied") {
    subEl.textContent = "Blocked";
    return;
  }
  if (permission === "granted" && !isNotificationsMuted()) {
    subEl.textContent = "On";
  } else {
    subEl.textContent = "Off";
  }
}


// ============================================
// ABOUT SETTINGS
// ============================================
function openAboutSettings() {
  const modal = document.getElementById("aboutModal");
  if (!modal) return;
  modal.classList.add("show");
  pushLayer("aboutModal", closeAboutSettings);
}

function closeAboutSettings() {
  const modal = document.getElementById("aboutModal");
  if (!modal) return;
  modal.classList.remove("show");
  popLayer("aboutModal");
}

// ============================================
// LEGAL PAGES — Terms / Privacy / Guidelines
// ============================================

// The three legal documents, stored as structured content.
// Each entry is { heading, body } — or { heading, list: [...] }.
const LEGAL_DOCS = {

  // ============================================
  // TERMS OF SERVICE
  // ============================================
  terms: {
    title: "Terms of Service",
    subtitle: "The rules that govern your use of Marketa.",
    updated: "Last updated: October 2026",
    sections: [
      {
        heading: "1. Who we are",
        body: "Marketa is a marketplace platform built for buyers and sellers in Ghana. We connect people who want to buy things with people who want to sell them, and we hold payments safely in escrow until a deal is completed. Marketa is not the seller of any item listed on the platform — we're the secure middleman."
      },
      {
        heading: "2. Your account",
        body: "You must be 18 or older to use Marketa, or have permission from a parent or guardian. You're responsible for keeping your password safe and for everything that happens under your account. Use one account per person — creating multiple accounts to get around restrictions is not allowed."
      },
      {
        heading: "3. Buying on Marketa",
        list: [
          "When you pay for an order, your money is held by Marketa — the seller does not receive it yet.",
          "The seller has 5 days to mark the order as shipped. If they don't, the order auto-cancels and you're refunded.",
          "Once shipped, you have 7 days to confirm delivery. If you don't, the funds are auto-released to the seller.",
          "You can extend either deadline once, as shown on the order card.",
          "If the item doesn't match the description, you can request a return or escalate to our moderation team."
        ]
      },
      {
        heading: "4. Selling on Marketa",
        list: [
          "You must describe items honestly — including condition, defects, and what's included.",
          "You must ship promptly after a buyer pays. Funds stay in escrow until the buyer confirms.",
          "You can't edit a listing that has an active order.",
          "Once you've sold all your stock, the listing is automatically marked as sold and removed from the public marketplace.",
          "We may remove any listing that breaks our rules (see the Community Guidelines for details)."
        ]
      },
      {
        heading: "5. Escrow and refunds",
        body: "Marketa holds payments in escrow until the buyer confirms delivery. If the buyer requests a return, the seller can refund the buyer. If the two can't agree, the case can be escalated to our moderation team, who will rule based on the evidence. Refunds are returned immediately from escrow; bank settlement typically takes 1–3 business days."
      },
      {
        heading: "6. Prohibited items and behaviour",
        body: "You may not use Marketa to sell illegal items, counterfeit goods, weapons, drugs, stolen property, or anything restricted under Ghanaian law. You may not scam, harass, impersonate, or defraud other users. Full details are in the Community Guidelines."
      },
      {
        heading: "7. Account restrictions and bans",
        body: "If you break these Terms, we may warn you, restrict specific features of your account, remove your listings, or permanently ban your account. Serious violations — like running scams, repeated false reports, or refusal to complete orders — may result in an immediate ban. You can appeal any ban by contacting us with your account email and an explanation."
      },
      {
        heading: "8. Fees",
        body: "Marketa is currently free to use — no listing fees, no commission, no escrow fees. In the future we may introduce optional paid features (such as promoting a listing). Any new fees will be clearly communicated before they take effect."
      },
      {
        heading: "9. Disclaimers",
        body: "Marketa is provided as-is. While we work hard to keep the platform safe and reliable, we can't guarantee every listing is accurate or every seller reliable. Use the safety tips in each listing, meet in public places, and inspect items before paying. Marketa is not liable for losses outside the escrow process."
      },
      {
        heading: "10. Changes to these Terms",
        body: "We may update these Terms as the platform evolves. When we make significant changes, we'll notify you in the app. Continuing to use Marketa after a change means you accept the updated Terms."
      }
    ]
  },

  // ============================================
  // PRIVACY POLICY
  // ============================================
  privacy: {
    title: "Privacy Policy",
    subtitle: "How we collect, use, and protect your information.",
    updated: "Last updated: October 2026",
    sections: [
      {
        heading: "1. What we collect",
        body: "When you sign up, we collect your email address and your display name. If you list items, we also collect your phone number and your area/region (used to arrange deliveries and shown to buyers you're dealing with). We do not collect your ID, bank details, or government numbers at this time."
      },
      {
        heading: "2. What other users see",
        list: [
          "Your display name — visible on your listings and in chats.",
          "Your area and region — shown on your listings.",
          "Your phone number — only shown to a buyer after they tap \"Show phone number\" on one of your listings.",
          "Your email address — never shown to other users."
        ]
      },
      {
        heading: "3. How we use your data",
        list: [
          "To operate the marketplace — showing listings, processing orders, facilitating chat.",
          "To protect escrow — verifying who's involved in each order.",
          "To resolve disputes — reviews and moderation decisions may use order and chat history.",
          "To improve Marketa — we may look at aggregated, anonymised usage patterns."
        ]
      },
      {
        heading: "4. What we don't do",
        body: "We never sell your personal information. We never share your email with other users. We don't run third-party advertising on Marketa. We don't send marketing emails."
      },
      {
        heading: "5. How long we keep your data",
        body: "Your account data is kept as long as your account is active. When you delete your account, your profile, listings, orders, chats, and reviews are removed from the active system. Some records (for example, order history relevant to an open dispute) may be retained a little longer for legal and dispute-resolution reasons."
      },
      {
        heading: "6. Security",
        body: "We use Firebase (Google Cloud) to store your data. Our Firestore rules enforce strict per-user access — only you can edit your own profile, only buyers and sellers of an order can see that order, and only moderators can review reports. Passwords are hashed by Firebase Authentication and are never visible to us."
      },
      {
        heading: "7. Your rights",
        list: [
          "You can edit your display name, phone number, and location at any time from Settings.",
          "You can change your password from Settings.",
          "You can delete your account from Settings — this is permanent.",
          "You can ask us what data we hold about you by emailing support@marketa.gh."
        ]
      },
      {
        heading: "8. Cookies and local storage",
        body: "We use your browser's local storage to remember things like your theme preference and which listings you've recently viewed. We don't use third-party tracking cookies or advertising trackers."
      },
      {
        heading: "9. Children",
        body: "Marketa is for users 18 and older, or users with permission from a parent or guardian. We don't knowingly collect data from children without that permission. If you believe a child is using Marketa, contact us and we'll investigate."
      },
      {
        heading: "10. Changes to this Policy",
        body: "We may update this Policy as the platform evolves. When we make significant changes, we'll notify you in the app. Continuing to use Marketa after a change means you accept the updated Policy."
      }
    ]
  },

  // ============================================
  // COMMUNITY GUIDELINES
  // ============================================
  guidelines: {
    title: "Community Guidelines",
    subtitle: "What's allowed, what's not, and what happens if you break the rules.",
    updated: "Last updated: October 2026",
    sections: [
      {
        heading: "🌟 Our one rule",
        body: "Treat others the way you'd want to be treated. Marketa works when buyers and sellers trust each other. Everything below is just a more detailed version of that one idea."
      },
      {
        heading: "✅ What we love",
        list: [
          "Honest, detailed listings with real photos.",
          "Fast shipping and clear communication.",
          "Buyers who inspect items before confirming and confirm honestly.",
          "People who report scams and bad actors to us.",
          "Sellers who help resolve problems quickly and fairly."
        ]
      },
      {
        heading: "🚫 Prohibited items",
        list: [
          "Illegal drugs and controlled substances.",
          "Weapons, ammunition, and explosives.",
          "Counterfeit goods or brand fakes.",
          "Stolen property.",
          "Live animals sold for cruelty, fighting, or slaughter outside normal farming.",
          "Human parts, organs, or tissues.",
          "Personal data, hacked accounts, or stolen credentials.",
          "Anything else restricted under Ghanaian law."
        ]
      },
      {
        heading: "🚫 Prohibited behaviour",
        list: [
          "Scams — taking money without delivering, or delivering something completely different from the listing.",
          "Fake listings — items you don't actually have, or photos you don't own.",
          "Impersonation — pretending to be someone else, including pretending to be Marketa staff.",
          "Harassment — threats, hate speech, sexual harassment, or repeated unwanted contact.",
          "Fake reports — reporting listings or users you know haven't broken any rules.",
          "Manipulation — artificially boosting your own ratings, followers, or views.",
          "Off-platform pressure — asking buyers to pay outside Marketa so you can avoid escrow."
        ]
      },
      {
        heading: "⚠️ What happens if you break a rule",
        body: "We look at every situation individually. Depending on severity and history, we may:",
        list: [
          "Remove the listing or content that broke the rules.",
          "Send you a warning through the in-app chat.",
          "Restrict certain features (like the ability to post listings or submit reports).",
          "Temporarily suspend your account.",
          "Permanently ban your account for serious or repeated violations."
        ]
      },
      {
        heading: "📣 Reporting a problem",
        list: [
          "Open any listing and tap \"Report this listing\" at the bottom of the seller section.",
          "Pick the reason that best describes the issue — add details if you'd like.",
          "A moderator reviews every report. You'll usually see an action within 24–48 hours.",
          "For emergencies or anything not covered by the report form, contact us at support@marketa.gh."
        ]
      },
      {
        heading: "🤝 Resolving disputes",
        list: [
          "Talk to the other party first — most issues are solved with a quick message.",
          "If you can't agree, use the Request Return or Escalate to Admin buttons in My Orders.",
          "Provide clear evidence — photos, chat history, order details.",
          "Admin rulings are final. We rule based on the evidence, not on who asks first."
        ]
      },
      {
        heading: "🛡️ Stay safe when meeting in person",
        list: [
          "Meet in a safe, public place during daytime — like a busy mall or market.",
          "Bring a friend if you can.",
          "Inspect the item carefully before handing over any money.",
          "Keep payment inside Marketa — never send money outside the platform.",
          "Trust your instincts. If something feels off, walk away and report it."
        ]
      },
      {
        heading: "💬 A note on fairness",
        body: "We do our best to be fair to everyone — buyers, sellers, and the wider community. If you believe a decision was wrong, you can always appeal by contacting us. We read every appeal, even when we can't change the outcome."
      }
    ]
  }

};

// Opens one of the legal documents.
// key = "terms" | "privacy" | "guidelines"
function openLegalDoc(key) {
  const doc = LEGAL_DOCS[key];
  if (!doc) return;

  // Save this page as the last location so a refresh can restore it.
  saveLastLocation("legalPage", { key: key });

  // Set titles
  const titleEl = document.getElementById("legalTitle");
  const subtitleEl = document.getElementById("legalSubtitle");
  const updatedEl = document.getElementById("legalUpdated");
  const crumbEl = document.getElementById("legalBreadcrumbTitle");

  if (titleEl) titleEl.textContent = doc.title;
  if (subtitleEl) subtitleEl.textContent = doc.subtitle || "";
  if (updatedEl) updatedEl.textContent = doc.updated || "";
  if (crumbEl) crumbEl.textContent = doc.title;

  // Build the content
  const container = document.getElementById("legalContent");
  if (container) {
    container.innerHTML = "";

    doc.sections.forEach(function (section) {
      const block = document.createElement("div");
      block.className = "legal-section";

      const h = document.createElement("h2");
      h.className = "legal-heading";
      h.textContent = section.heading;
      block.appendChild(h);

      if (section.body) {
        const p = document.createElement("p");
        p.className = "legal-body";
        p.textContent = section.body;
        block.appendChild(p);
      }

      if (section.list && section.list.length) {
        const ul = document.createElement("ul");
        ul.className = "legal-list";
        section.list.forEach(function (item) {
          const li = document.createElement("li");
          li.textContent = item;
          ul.appendChild(li);
        });
        block.appendChild(ul);
      }

      container.appendChild(block);
    });
  }

  // Hide Settings visually but KEEP it in the layer stack,
  // so closing the Legal page returns the user to Settings.
  const settingsPage = document.getElementById("settingsPage");
  if (settingsPage) settingsPage.style.display = "none";

  // Show the Legal page
  const page = document.getElementById("legalPage");
  if (page) page.style.display = "flex";
  document.body.classList.add("page-open");

  // Tell the layer manager
  pushLayer("legalPage", closeLegalPage);

  // Scroll to top
  window.scrollTo(0, 0);
}

// Closes the legal page.
function closeLegalPage() {
  const page = document.getElementById("legalPage");
  if (page) page.style.display = "none";

  // Tell the layer manager
  popLayer("legalPage");

  // If the Settings page is still on the stack, bring it back
  if (_layerStack.some(function (l) { return l.id === "settingsPage"; })) {
    const settingsPage = document.getElementById("settingsPage");
    if (settingsPage) settingsPage.style.display = "flex";
  } else {
    // No Settings underneath — clean up "page-open"
    if (!hasAnotherPageOpen("legalPage")) {
      document.body.classList.remove("page-open");
    }
  }
}

// ============================================
// DELETE ACCOUNT
// ============================================
function openDeleteAccount() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  const modal = document.getElementById("deleteAccountModal");
  if (!modal) return;

  const input = document.getElementById("deleteConfirmInput");
  const errEl = document.getElementById("deleteAccountError");
  if (input) input.value = "";
  if (errEl) errEl.style.display = "none";

  modal.classList.add("show");
  pushLayer("deleteAccountModal", closeDeleteAccount);
}

function closeDeleteAccount() {
  const modal = document.getElementById("deleteAccountModal");
  if (!modal) return;
  modal.classList.remove("show");
  popLayer("deleteAccountModal");
}

async function confirmDeleteAccount() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  const input = document.getElementById("deleteConfirmInput");
  const errEl = document.getElementById("deleteAccountError");
  const typed = (input.value || "").trim().toUpperCase();

  errEl.style.display = "none";

  if (typed !== "DELETE") {
    errEl.textContent = "Please type DELETE exactly to confirm.";
    errEl.style.display = "block";
    return;
  }

  try {
    const mod = await getAuthModule();

    // Try to actually delete the Firebase user.
    // Works if the user signed in recently.
    // If not, we fall back to signing out.
    try {
      await mod.deleteUser(user);
      marketaToast("Account deleted. Goodbye 👋");
    } catch (deleteErr) {
      const code = deleteErr.code || "";
      if (code.includes("requires-recent-login")) {
        marketaToast("Please sign in again, then retry delete.");
      } else {
        throw deleteErr;
      }
    }

    closeDeleteAccount();
    closeSettings();
    closeProfile();

    // Clear caches
    allListingsCache = [];
    allOrdersCache = [];
    allThreadsCache = [];

    // Sign out
    try { await mod.signOut(mod.auth); } catch (e) {}
    currentAuthUser = null;
    currentUserId = null;
    localStorage.removeItem("marketaUserId");
    localStorage.removeItem("marketaUserEmail");

    updateHeaderAuth();
    document.querySelectorAll(".bottom-nav-item").forEach(function(el) {
      el.classList.toggle("active", el.getAttribute("data-tab") === "home");
    });

    // Reload listings for guest view
    await loadListingsFromFirestore().catch(function(e) { console.warn(e); });
    renderListings(allListingsCache);

  } catch (err) {
    errEl.textContent = "Couldn't delete account: " + (err.message || "unknown error");
    errEl.style.display = "block";
  }
}

// ============================================
// DRAWER
// ============================================
function openDrawer() {
  const drawer = document.getElementById("mainDrawer");
  const overlay = document.getElementById("drawerOverlay");
  if (!drawer || !overlay) return;

  // Show/hide personal drawer items based on login state
  updateDrawerForAuthState();
  
  // If Firebase hasn't finished, check again in 500ms
if (!_authReady) {
  setTimeout(function() {
    updateDrawerForAuthState();
    refreshDrawerModerationRow();
  }, 500);
}

  // Show the moderation row only for admins
  refreshDrawerModerationRow();

  // Update the theme toggle label
  updateDrawerThemeLabel();

  // Highlight the currently-open page (if any)
  updateDrawerActiveState();

  overlay.classList.add("show");

  requestAnimationFrame(function () {
    drawer.classList.add("show");
  });

  document.body.classList.add("drawer-open");

  // Tell the layer manager we're open (so back button closes us)
  pushLayer("mainDrawer", closeDrawer);
}

function closeDrawer() {
  const drawer = document.getElementById("mainDrawer");
  const overlay = document.getElementById("drawerOverlay");
  if (!drawer || !overlay) return;

  drawer.classList.remove("show");
  overlay.classList.remove("show");
  document.body.classList.remove("drawer-open");

  // Tell the layer manager we're closed
  popLayer("mainDrawer");
}

// Highlight the currently-open page in the drawer
function updateDrawerActiveState() {
  // Clear any existing highlights
  document.querySelectorAll(".drawer-grid-btn").forEach(function (btn) {
    btn.classList.remove("active");
  });

  // Give the DOM a tick to settle, then apply
  setTimeout(function () {
    let activePage = null;

    const isShown = function (el) {
      if (!el) return false;
      return el.style.display === "flex" || el.classList.contains("show");
    };

    if (isShown(document.getElementById("profilePage"))) activePage = "profile";
    else if (isShown(document.getElementById("listingsModal"))) activePage = "listings";
    else if (isShown(document.getElementById("shopModal"))) activePage = "shop";
    else if (isShown(document.getElementById("ordersModal"))) activePage = "orders";
    else if (isShown(document.getElementById("messagesModal"))) activePage = "messages";
    else if (isShown(document.getElementById("wishlistPage"))) activePage = "wishlist";

    console.log("[Drawer] Active page detected:", activePage);

    if (!activePage) return;

    const target = document.querySelector('.drawer-grid-btn[data-page="' + activePage + '"]');
    if (target) {
      target.classList.add("active");
      console.log("[Drawer] Applied active class to:", activePage);
    } else {
      console.log("[Drawer] No button found for:", activePage);
    }
  }, 50);
}

function drawerGoToSearch() {
  const input = document.getElementById("drawerSearchInput");
  const query = (input ? input.value : "").trim();
  closeDrawer();

  // Open the search page
  openSearchPage();

  // Pre-fill the search page's input with whatever they typed
  if (query) {
    setTimeout(function () {
      const searchInput = document.getElementById("searchPageInput");
      if (searchInput) {
        searchInput.value = query;
        searchPageQuery();
      }
    }, 200);
  }

  if (input) input.value = "";
}

function toggleThemeFromDrawer() {
  // Flip between light and dark; keeps it simple
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = (current === "dark") ? "light" : "dark";
  applyThemeChoice(next);
  updateDrawerThemeLabel();
}

function updateDrawerThemeLabel() {
  const label = document.getElementById("drawerThemeLabel");
  const icon = document.getElementById("drawerThemeIcon");
  if (!label) return;

  const current = document.documentElement.getAttribute("data-theme") || "light";
  if (current === "dark") {
    label.textContent = "Switch to light mode";
    if (icon) icon.textContent = "☀️";
  } else {
    label.textContent = "Switch to dark mode";
    if (icon) icon.textContent = "🌙";
  }
}

// --------------------------------------------------
// Moderation row visibility (admin only)
// --------------------------------------------------
async function refreshDrawerModerationRow() {
  const row = document.getElementById("drawerModerationBtn");
  if (!row) return;

  // Hide by default; show only if we can confirm the user is admin.
  row.style.display = "none";

  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) {
    _isAdminCache = false;
    return;
  }

  // If we've already checked this session, use the cached result.
  if (_isAdminCache === true) {
    row.style.display = "flex";
    return;
  }
  if (_isAdminCache === false) {
    return;
  }

  // Otherwise, read Firestore once and cache the answer.
  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", user.uid));
    const isAdmin = snap.exists() && snap.data().isAdmin === true;
    _isAdminCache = isAdmin;
    if (isAdmin) {
      row.style.display = "flex";
    }
  } catch (err) {
    _isAdminCache = false;
  }
}
// ============================================
// PROFILE PAGE — helper utilities
// ============================================
function formatMemberSince(creationTimeOrMs) {
  if (!creationTimeOrMs) return "—";
  const ms = typeof creationTimeOrMs === "number"
    ? creationTimeOrMs
    : Number(creationTimeOrMs);
  if (!ms || isNaN(ms)) return "—";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "—";
  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
  return monthNames[d.getMonth()] + " " + d.getFullYear();
}
// Populate the new Profile card fields (member since, location, account type)
async function populateProfileCardFields(user) {
  if (!user) return;

  // ---- Member since ----
  // Firebase Auth gives us creationTime as a string timestamp in ms
  const memberEl = document.getElementById("profileMemberSince");
  if (memberEl) {
    if (user.metadata && user.metadata.creationTime) {
      const ms = Date.parse(user.metadata.creationTime);
      memberEl.textContent = formatMemberSince(ms);
    } else {
      memberEl.textContent = "—";
    }
  }

  // ---- Account type + Location (read from Firestore users/{uid}) ----
  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", user.uid));

    let isAdmin = false;
let locationText = "";
if (snap.exists()) {
  const data = snap.data();
  isAdmin = data.isAdmin === true;
  const area = data.locationArea || "";
  const region = data.locationRegion || "";
  if (area && region) locationText = area + ", " + region;
  else if (area) locationText = area;
  else if (region) locationText = region;
}

    const typeEl = document.getElementById("profileAccountType");
    if (typeEl) {
      typeEl.textContent = isAdmin ? "Admin" : "Buyer";
    }

    const locEl = document.getElementById("profileLocation");
if (locEl) {
  locEl.textContent = locationText || "Not set";
}

// ---- Bio + Website rows ----
const bioRow = document.getElementById("profileBioRow");
const bioEl = document.getElementById("profileBio");
const websiteRow = document.getElementById("profileWebsiteRow");
const websiteEl = document.getElementById("profileWebsite");

let bio = "";
let website = "";
if (snap.exists()) {
  const ud = snap.data();
  bio = (ud.bio || "").trim();
  website = (ud.website || "").trim();
}

// Bio
if (bioRow && bioEl) {
  if (bio) {
    bioEl.textContent = bio;
    bioRow.style.display = "";
  } else {
    bioRow.style.display = "none";
  }
}

// Website (make it a link)
if (websiteRow && websiteEl) {
  if (website) {
    // Prepend https:// if the user didn't type a scheme
    let href = website;
    if (!/^https?:\/\//i.test(href)) {
      href = "https://" + href;
    }
    websiteEl.innerHTML =
      '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" ' +
      'style="color:var(--green-main);font-weight:700;text-decoration:none;word-break:break-all;">' +
      escapeHtml(website) +
      '</a>';
    websiteRow.style.display = "";
  } else {
    websiteRow.style.display = "none";
  }
}

    // Cache admin status too (we set this elsewhere — keep it in sync)
    _isAdminCache = isAdmin;
  } catch (err) {
    console.warn("populateProfileCardFields failed:", err);
  }
}

/* ============================================
   SESSION F — DECREMENT LISTING QUANTITY
   ============================================ */

// Called when an order's funds are released (sale complete).
// Reduces the listing's quantity by the order's quantity.
// If quantity hits 0, auto-marks the listing as sold.
async function decrementListingQuantity(order) {
  if (!order || !order.itemId) {
    console.warn("decrementListingQuantity failed:", err);
    return;
  }

  const listing = allListingsCache.find(function (l) { return l.id === order.itemId; });
  if (!listing) {
    console.warn("decrementListingQuantity failed:", err);
    return;
  }

  const soldQty = Number(order.quantity) || 1;
  const currentQty = (listing.quantity !== undefined) ? Number(listing.quantity) : 1;
  const newQty = Math.max(0, currentQty - soldQty);

  try {
    const { db, doc, setDoc } = await getFsModules();

    const updated = Object.assign({}, listing, {
      quantity: newQty,
      sold: newQty === 0
    });

    await setDoc(doc(db, "listings", String(listing.id)), updated);

    // Update the local cache
    listing.quantity = newQty;
    if (newQty === 0) listing.sold = true;

    // Refresh the home grid
    renderListings(allListingsCache);
  } catch (err) {
    console.warn("decrementListingQuantity failed:", err);
  }
}

/* ============================================
   SESSION F — RESTORE LISTING QUANTITY (REFUNDS)
   ============================================ */

// Called when an order is refunded. Adds the order's
// quantity back to the listing. If the listing was
// marked sold because qty hit 0, we un-mark it.
async function restoreListingQuantity(order) {
  if (!order || !order.itemId) return;

  const listing = allListingsCache.find(function (l) { return l.id === order.itemId; });
  if (!listing) return;

  const refundedQty = Number(order.quantity) || 1;
  const currentQty = (listing.quantity !== undefined) ? Number(listing.quantity) : 1;
  const newQty = currentQty + refundedQty;

  try {
    const { db, doc, setDoc } = await getFsModules();

    const updated = Object.assign({}, listing, {
      quantity: newQty,
      sold: false
    });

    await setDoc(doc(db, "listings", String(listing.id)), updated);

    // Update local cache
    listing.quantity = newQty;
    listing.sold = false;

    // Refresh the home grid
    renderListings(allListingsCache);
  } catch (err) {
    console.warn("restoreListingQuantity failed:", err);
  }
}

// ============================================
// AUTO-MARK LISTING AS SOLD
// ============================================
// Called when an order's funds are released to the seller.
// Sets the listing's sold flag to true so it counts as Sold
// and disappears from Browse.
async function autoMarkListingSold(order) {
  if (!order || !order.itemId) return;

  // Find the listing in our cache
  const listing = allListingsCache.find(function (l) { return l.id === order.itemId; });
  if (!listing) return;

  // Already marked sold? Nothing to do.
  if (listing.sold === true) return;

  try {
    const { db, doc, setDoc } = await getFsModules();
    const updated = Object.assign({}, listing, { sold: true });
    await setDoc(doc(db, "listings", String(listing.id)), updated);

    // Update the local cache so the UI sees it immediately
    listing.sold = true;
  } catch (err) {
    console.warn("autoMarkListingSold failed:", err);
  }
}
// Returns "(held in escrow)" or "(released)" or "(refunded)"
// depending on the order's status
function escrowLabel(order) {
  if (!order || !order.status) return "";
  const s = order.status;
  if (s === "Paid — funds held in escrow" ||
      s === "Shipped — on the way" ||
      s === "returnRequested" ||
      s === "disputed") {
    return " (held in escrow)";
  }
  if (s === "Funds released to seller") return " (released)";
  if (s === "refunded") return " (refunded)";
  return "";
}
// ============================================
// MODERATION PANEL (Session 19)
// ============================================
let _moderationTab = "disputes";

async function openModeration() {
  // Admin check
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { openAuthFromHeader(); return; }

  // Confirm the user is admin (respect the cached value if we have it)
  if (_isAdminCache !== true) {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
      marketaAlert("Admin only", "You don't have access to the Moderation panel.");
      return;
    }
  }

// Show or hide the Moderators tab based on ownership
const modTabBtn = document.querySelector('.mod-tab[data-tab="moderators"]');
if (modTabBtn) {
  modTabBtn.style.display = isCurrentUserOwner() ? "" : "none";
}

// Show or hide the Analytics tab based on ownership
const analyticsTabBtn = document.getElementById("modTabAnalytics");
if (analyticsTabBtn) {
  analyticsTabBtn.style.display = isCurrentUserOwner() ? "" : "none";
}

  const page = document.getElementById("moderationPage");
  if (!page) return;

  page.style.display = "flex";

  // Set signed-in name
  const signedEl = document.getElementById("moderationSignedIn");
  if (signedEl) {
    signedEl.textContent = user.displayName
      || (user.email ? user.email.split("@")[0] : "Admin");
  }

  // Populate stat cards + render the current tab
  renderModerationStats();
  renderModerationTab();

  // Tell the layer manager we're open
  pushLayer("moderationPage", closeModeration);
}

function closeModeration() {
  const page = document.getElementById("moderationPage");
  if (page) page.style.display = "none";

  // Tell the layer manager we're closed
  popLayer("moderationPage");
}

function switchModerationTab(tab) {
  _moderationTab = tab;
  document.querySelectorAll(".mod-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  renderModerationTab();
}

// Master renderer — picks the right sub-tab and renders its body
function renderModerationTab() {
  const body = document.getElementById("modTabBody");
  if (!body) return;

  body.innerHTML = "";

  if (_moderationTab === "disputes") {
    renderModDisputes(body);
  } else if (_moderationTab === "orders") {
    renderModOrdersPlaceholder(body);
  } else if (_moderationTab === "users") {
    renderModUsersPlaceholder(body);
  } else if (_moderationTab === "moderators") {
  renderModModeratorsPlaceholder(body);
} else if (_moderationTab === "reports") {
  renderModReportsPlaceholder(body);
} else if (_moderationTab === "tickets") {
  renderModTicketsPlaceholder(body);
} else if (_moderationTab === "analytics") {
  renderModAnalytics(body);
}
}

// Async admin check (reads Firestore once, caches)
async function checkIsAdmin() {
  if (_isAdminCache === true) return true;
  if (_isAdminCache === false) return false;

  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!user) { _isAdminCache = false; return false; }

  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", user.uid));
    const isAdmin = snap.exists() && snap.data().isAdmin === true;
    _isAdminCache = isAdmin;
    return isAdmin;
  } catch (err) {
    _isAdminCache = false;
    return false;
  }
}
// ============================================
// MODERATION — STAT CARDS
// ============================================
function renderModerationStats() {
  // We compute from allOrdersCache (already loaded)
  const orders = allOrdersCache.slice();

  // Open disputes
  const openDisputes = orders.filter(function (o) {
    return o.status === "disputed";
  }).length;

  // Total orders
  const totalOrders = orders.length;

  // Orders in escrow = orders where money is still held
  const escrowStatuses = [
    "Paid — funds held in escrow",
    "Shipped — on the way",
    "returnRequested",
    "disputed"
  ];
  const ordersInEscrow = orders.filter(function (o) {
    return escrowStatuses.indexOf(o.status) !== -1;
  }).length;

  // Held in escrow = sum of totals
  let heldTotal = 0;
  orders.forEach(function (o) {
    if (escrowStatuses.indexOf(o.status) !== -1) {
      heldTotal += Number(o.total) || 0;
    }
  });

  // Populate
  const openEl = document.getElementById("modStatOpenDisputes");
  const totalEl = document.getElementById("modStatTotalOrders");
  const escrowCountEl = document.getElementById("modStatOrdersEscrow");
  const escrowMoneyEl = document.getElementById("modStatHeldEscrow");

  if (openEl) openEl.textContent = openDisputes;
  if (totalEl) totalEl.textContent = totalOrders;
  if (escrowCountEl) escrowCountEl.textContent = ordersInEscrow;
  if (escrowMoneyEl) escrowMoneyEl.textContent = "GH₵ " + heldTotal.toLocaleString();
}

// ============================================
// MODERATION — DISPUTES TAB
// ============================================
let _modDisputesSubTab = "open";

function renderModDisputes(body) {
  // Sub-filter pills
  const subtabsHtml =
    '<div class="mod-subtabs">' +
      '<button class="mod-subtab ' + (_modDisputesSubTab === "open" ? "active" : "") + '" data-sub="open" onclick="filterModDisputes(\'open\')">Open</button>' +
      '<button class="mod-subtab ' + (_modDisputesSubTab === "all" ? "active" : "") + '" data-sub="all" onclick="filterModDisputes(\'all\')">All</button>' +
      '<button class="mod-subtab ' + (_modDisputesSubTab === "refunded" ? "active" : "") + '" data-sub="refunded" onclick="filterModDisputes(\'refunded\')">Refunded</button>' +
      '<button class="mod-subtab ' + (_modDisputesSubTab === "released" ? "active" : "") + '" data-sub="released" onclick="filterModDisputes(\'released\')">Released</button>' +
    '</div>';

  // Filter orders
  const allDisputes = allOrdersCache.filter(function (o) {
    return o.status === "disputed" ||
           (o.status === "refunded" && o.returnReason) ||
           (o.status === "Funds released to seller" && o.returnReason);
  });

  let shown = allDisputes;
  if (_modDisputesSubTab === "open") {
    shown = allDisputes.filter(function (o) { return o.status === "disputed"; });
  } else if (_modDisputesSubTab === "refunded") {
    shown = allDisputes.filter(function (o) { return o.status === "refunded"; });
  } else if (_modDisputesSubTab === "released") {
    shown = allDisputes.filter(function (o) { return o.status === "Funds released to seller"; });
  }

  // Sort newest first
  shown.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

  // Build the body
  let html = subtabsHtml;

  if (shown.length === 0) {
    let emptyTitle = "No disputes";
    let emptyText = "Nothing to review right now.";
    if (_modDisputesSubTab === "open") {
      emptyTitle = "No open disputes";
      emptyText = "Nice — there are no disputes waiting for a decision right now.";
    } else if (_modDisputesSubTab === "refunded") {
      emptyTitle = "No refunded disputes";
      emptyText = "Refunded disputes will appear here.";
    } else if (_modDisputesSubTab === "released") {
      emptyTitle = "No released disputes";
      emptyText = "Disputes resolved in the seller's favour appear here.";
    }

    html +=
      '<div class="empty-state">' +
        '<div class="empty-state-icon">🛡️</div>' +
        '<div class="empty-state-title">' + emptyTitle + '</div>' +
        '<div class="empty-state-text">' + emptyText + '</div>' +
      '</div>';
  } else {
    html += '<div class="mod-cards-list">';
    shown.forEach(function (o) {
      html += modDisputeCard(o);
    });
    html += '</div>';
  }

  body.innerHTML = html;
}

function filterModDisputes(sub) {
  _modDisputesSubTab = sub;
  renderModerationTab();
}

function modDisputeCard(order) {
  const buyer = order.buyerPhone || "—";
  const seller = order.sellerId ? "Seller" : "—";
  const timeText = order.disputedAt || order.date || "";
  const reason = order.returnReason || "Not stated";
  const note = order.returnNote ? '<div class="mod-card-row">📝 ' + escapeHtml(order.returnNote) + '</div>' : "";

  // Status-based action buttons
  let statusBadge = "";
  let actions = "";

  if (order.status === "disputed") {
    statusBadge = '<span class="mod-badge mod-badge-open">⚖️ Open</span>';
    actions =
      '<button class="mod-action-btn mod-action-refund" onclick="modRuleDispute(\'' + order.ref + '\', \'refund\')">💸 Refund Buyer</button>' +
      '<button class="mod-action-btn mod-action-release" onclick="modRuleDispute(\'' + order.ref + '\', \'release\')">✅ Release to Seller</button>';
  } else if (order.status === "refunded") {
    statusBadge = '<span class="mod-badge mod-badge-refunded">🛡️ Refunded</span>';
  } else if (order.status === "Funds released to seller") {
    statusBadge = '<span class="mod-badge mod-badge-released">✅ Released</span>';
  }

  return (
    '<div class="mod-card">' +
      '<div class="mod-card-header">' +
        '<span class="mod-card-title">' + escapeHtml(order.ref) + ' — ' + escapeHtml(getOrderDisplayName(order)) + '</span>' +
        statusBadge +
      '</div>' +
      '<div class="mod-card-row">💰 <strong>GH₵ ' + Number(order.total).toLocaleString() + '</strong></div>' +
      '<div class="mod-card-row">📞 Buyer: ' + escapeHtml(buyer) + '</div>' +
      '<div class="mod-card-row">🧑‍💼 Seller: ' + escapeHtml(seller) + '</div>' +
      '<div class="mod-card-row">⚠️ Reason: ' + escapeHtml(reason) + '</div>' +
      note +
      (timeText ? '<div class="mod-card-row mod-card-time">📅 ' + escapeHtml(timeText) + '</div>' : '') +
      '<div class="mod-card-actions">' +
        '<button class="mod-action-btn mod-action-neutral" onclick="modOpenThread(\'' + order.ref + '\')">💬 Open Thread</button>' +
        actions +
      '</div>' +
    '</div>'
  );
}

function modOpenThread(ref) {
  // Reuse the existing dispute chat modal
  openThread(ref, "admin");
}

// Admin ruling from the moderation panel
async function modRuleDispute(ref, ruling) {
  const order = allOrdersCache.find(function (o) { return o.ref === ref; });
  if (!order) { marketaAlert("Not found", "Order not found."); return; }

  const label = (ruling === "refund") ? "refund the buyer" : "release funds to the seller";
  marketaConfirm(
    "⚖️ Confirm ruling",
    "Are you sure you want to " + label + "?\n\nThis is final and cannot be undone.",
    async function () {
      order.status = (ruling === "refund") ? "refunded" : "Funds released to seller";
order.ruledBy = "admin";
order.ruledAt = new Date().toLocaleString();
if (ruling === "release") order.releasedAt = Date.now();  // ← record release time
      if (!order.thread) order.thread = [];
      order.thread.push({
        from: "admin",
        text: (ruling === "refund")
          ? "⚖️ FINAL RULING: Refund approved. The buyer will be refunded from escrow."
          : "⚖️ FINAL RULING: Funds released to the seller. Case closed.",
        time: new Date().toLocaleString(),
        sentAt: Date.now()
      });

      try {
        await saveOrderToFirestore(order);
        // Adjust listing stock based on ruling
if (ruling === "refund") {
  await restoreListingQuantity(order);
} else {
  await decrementListingQuantity(order);
}
        await loadOrdersFromFirestore();
        renderModerationStats();
        renderModerationTab();
        marketaToast("Ruling saved ✅");
      } catch (err) {
        marketaAlert("❌ Error", "Failed: " + err.message);
      }
    },
    null
  );
}

// ============================================
// MODERATION — ORDERS TAB
// ============================================
let _modOrdersSubTab = "all";
let _modOrdersSearch = "";

function renderModOrdersPlaceholder(body) {
  // Sub-filter pills
  const subtabsHtml =
    '<div class="mod-subtabs mod-subtabs-multi">' +
      '<button class="mod-subtab ' + (_modOrdersSubTab === "all" ? "active" : "") + '" onclick="filterModOrders(\'all\')">All</button>' +
      '<button class="mod-subtab ' + (_modOrdersSubTab === "awaiting" ? "active" : "") + '" onclick="filterModOrders(\'awaiting\')">Awaiting shipment</button>' +
      '<button class="mod-subtab ' + (_modOrdersSubTab === "transit" ? "active" : "") + '" onclick="filterModOrders(\'transit\')">In transit</button>' +
      '<button class="mod-subtab ' + (_modOrdersSubTab === "completed" ? "active" : "") + '" onclick="filterModOrders(\'completed\')">Completed</button>' +
      '<button class="mod-subtab ' + (_modOrdersSubTab === "disputed" ? "active" : "") + '" onclick="filterModOrders(\'disputed\')">Disputed</button>' +
      '<button class="mod-subtab ' + (_modOrdersSubTab === "returned" ? "active" : "") + '" onclick="filterModOrders(\'returned\')">Returned</button>' +
      '<button class="mod-subtab ' + (_modOrdersSubTab === "refunded" ? "active" : "") + '" onclick="filterModOrders(\'refunded\')">Refunded</button>' +
    '</div>';

  // Search bar
  const searchHtml =
    '<div class="mod-search-wrap">' +
      '<span class="mod-search-icon">🔍</span>' +
      '<input type="text" class="mod-search-input" placeholder="Search code, item, buyer, seller..." value="' + escapeHtml(_modOrdersSearch) + '" oninput="modOrdersSearch(this.value)">' +
    '</div>';

  // Filter
  let shown = allOrdersCache.slice();

  if (_modOrdersSubTab === "awaiting") {
    shown = shown.filter(function (o) { return o.status === "Paid — funds held in escrow"; });
  } else if (_modOrdersSubTab === "transit") {
    shown = shown.filter(function (o) { return o.status === "Shipped — on the way"; });
  } else if (_modOrdersSubTab === "completed") {
    shown = shown.filter(function (o) { return o.status === "Funds released to seller"; });
  } else if (_modOrdersSubTab === "disputed") {
    shown = shown.filter(function (o) { return o.status === "disputed"; });
  } else if (_modOrdersSubTab === "returned") {
    shown = shown.filter(function (o) { return o.status === "returnRequested"; });
  } else if (_modOrdersSubTab === "refunded") {
    shown = shown.filter(function (o) { return o.status === "refunded"; });
  }

  // Search filter
  if (_modOrdersSearch) {
    const q = _modOrdersSearch.toLowerCase();
    shown = shown.filter(function (o) {
      const item = (getOrderDisplayName(o) || "").toLowerCase();
      const ref = (o.ref || "").toLowerCase();
      const buyer = (o.buyerPhone || "").toLowerCase();
      const seller = (o.sellerId || "").toLowerCase();
      return ref.includes(q) || item.includes(q) || buyer.includes(q) || seller.includes(q);
    });
  }

  // Sort newest first
  shown.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

  // Count line
  const totalCount = allOrdersCache.length;
  const countHtml = '<div class="mod-count-line">' + shown.length + ' of ' + totalCount + ' orders</div>';

  // Body
  let html = subtabsHtml + searchHtml + countHtml;

  if (shown.length === 0) {
    html +=
      '<div class="empty-state">' +
        '<div class="empty-state-icon">📋</div>' +
        '<div class="empty-state-title">No orders match</div>' +
        '<div class="empty-state-text">Try a different status filter or clear your search.</div>' +
      '</div>';
  } else {
    html += '<div class="mod-cards-list">';
    shown.forEach(function (o) {
      html += modOrderCard(o);
    });
    html += '</div>';
  }

  body.innerHTML = html;
}

function filterModOrders(sub) {
  _modOrdersSubTab = sub;
  renderModerationTab();
}

function modOrdersSearch(val) {
  _modOrdersSearch = val || "";
  renderModerationTab();
  // Keep focus in the search input after re-render
  setTimeout(function () {
    const input = document.querySelector(".mod-search-input");
    if (input) {
      input.focus();
      // Move cursor to end
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }, 0);
}

function modOrderCard(o) {
  const item = getOrderDisplayName(o);
  const ref = o.ref || "—";
  const total = Number(o.total) || 0;
  const buyer = o.buyerPhone || "—";
  const location = o.buyerLocation || "—";
  const date = o.date || "";

  // Status badge
  let statusBadge = "";
  const s = o.status;
  if (s === "Paid — funds held in escrow") {
    statusBadge = '<span class="mod-badge mod-badge-open">⏳ Awaiting shipment</span>';
  } else if (s === "Shipped — on the way") {
    statusBadge = '<span class="mod-badge mod-badge-open">🚚 In transit</span>';
  } else if (s === "Funds released to seller") {
    statusBadge = '<span class="mod-badge mod-badge-released">✅ Completed</span>';
  } else if (s === "disputed") {
    statusBadge = '<span class="mod-badge mod-badge-dispute">⚖️ Disputed</span>';
  } else if (s === "returnRequested") {
    statusBadge = '<span class="mod-badge mod-badge-open">↩️ Returned</span>';
  } else if (s === "refunded") {
    statusBadge = '<span class="mod-badge mod-badge-refunded">🛡️ Refunded</span>';
  } else {
    statusBadge = '<span class="mod-badge">' + escapeHtml(s || "") + '</span>';
  }

  return (
    '<div class="mod-card">' +
      '<div class="mod-card-header">' +
        '<span class="mod-card-title">' + escapeHtml(ref) + ' — ' + escapeHtml(item) + '</span>' +
        statusBadge +
      '</div>' +
      '<div class="mod-card-row">💰 <strong>GH₵ ' + total.toLocaleString() + '</strong></div>' +
'<div class="mod-card-row">📞 ' + escapeHtml(buyer) + ' · ' + locationIcon() + ' ' + escapeHtml(location) + '</div>' +      (date ? 
'<div class="mod-card-row mod-card-time">📅 ' + escapeHtml(date) + '</div>' : '') +
      '<div class="mod-card-actions">' +
        '<button class="mod-action-btn mod-action-neutral" onclick="modOpenOrderThread(\'' + ref + '\')">💬 Open Thread</button>' +
      '</div>' +
    '</div>'
  );
}

function modOpenOrderThread(ref) {
  openThread(ref, "admin");
}

// ============================================
// MODERATION — USERS TAB
// ============================================
let _modUsersSubTab = "all";
let _modUsersSearch = "";
let _modUsersCache = [];

async function renderModUsersPlaceholder(body) {
  // Show loading the first time
  body.innerHTML = '<p class="mod-loading">Loading users…</p>';

  // Fetch users
  await loadModUsers();

  // Filter
  let shown = _modUsersCache.slice();

  // Sub-tab filter
  if (_modUsersSubTab === "admin") {
    shown = shown.filter(function (u) { return u.isAdmin === true; });
  } else if (_modUsersSubTab === "seller") {
    shown = shown.filter(function (u) { return u.isSeller === true && u.isAdmin !== true; });
  } else if (_modUsersSubTab === "buyer") {
    shown = shown.filter(function (u) { return u.isSeller !== true && u.isAdmin !== true; });
  }

  // Search filter
  if (_modUsersSearch) {
    const q = _modUsersSearch.toLowerCase();
    shown = shown.filter(function (u) {
      const name = (u.displayName || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }

  // Counts per category (from the full cache, not the filtered list)
  const allCount = _modUsersCache.length;
  const adminCount = _modUsersCache.filter(function (u) { return u.isAdmin === true; }).length;
  const sellerCount = _modUsersCache.filter(function (u) { return u.isSeller === true && u.isAdmin !== true; }).length;
  const buyerCount = _modUsersCache.filter(function (u) { return u.isSeller !== true && u.isAdmin !== true; }).length;

  // Sub-tab pills
  const subtabsHtml =
    '<div class="mod-subtabs">' +
      '<button class="mod-subtab ' + (_modUsersSubTab === "all" ? "active" : "") + '" onclick="filterModUsers(\'all\')">All (' + allCount + ')</button>' +
      '<button class="mod-subtab ' + (_modUsersSubTab === "admin" ? "active" : "") + '" onclick="filterModUsers(\'admin\')">Admin (' + adminCount + ')</button>' +
      '<button class="mod-subtab ' + (_modUsersSubTab === "seller" ? "active" : "") + '" onclick="filterModUsers(\'seller\')">Seller (' + sellerCount + ')</button>' +
      '<button class="mod-subtab ' + (_modUsersSubTab === "buyer" ? "active" : "") + '" onclick="filterModUsers(\'buyer\')">Buyer (' + buyerCount + ')</button>' +
    '</div>';

  // Search bar
  const searchHtml =
    '<div class="mod-search-wrap">' +
      '<span class="mod-search-icon">🔍</span>' +
      '<input type="text" class="mod-search-input" placeholder="Search name or email..." value="' + escapeHtml(_modUsersSearch) + '" oninput="modUsersSearch(this.value)">' +
    '</div>';

  // Count line
  const countHtml = '<div class="mod-count-line">' + shown.length + ' user' + (shown.length === 1 ? '' : 's') + '</div>';

  // Body
  let html = subtabsHtml + searchHtml + countHtml;

  if (shown.length === 0) {
    html +=
      '<div class="empty-state">' +
        '<div class="empty-state-icon">👥</div>' +
        '<div class="empty-state-title">No users match</div>' +
        '<div class="empty-state-text">Try a different filter or clear your search.</div>' +
      '</div>';
  } else {
    html += '<div class="mod-cards-list">';
    shown.forEach(function (u) {
      html += modUserCard(u);
    });
    html += '</div>';
  }

  body.innerHTML = html;
}

// Load all users from Firestore (with caching)
async function loadModUsers() {
  if (_modUsersCache.length > 0) return _modUsersCache;

  try {
    const { db, collection, getDocs } = await getFsModules();
    const snap = await getDocs(collection(db, "users"));

    const users = [];
    snap.forEach(function (docSnap) {
      const u = docSnap.data();
      u._uid = docSnap.id;
      users.push(u);
    });

    // Mark sellers (anyone with at least one listing)
    const sellerIds = {};
    allListingsCache.forEach(function (l) {
      if (l.sellerId) sellerIds[l.sellerId] = true;
    });
    users.forEach(function (u) {
      u.isSeller = !!sellerIds[u._uid];
    });

    // Sort newest joined first
    users.sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    _modUsersCache = users;
    return users;
  } catch (err) {
    console.warn("Failed to load users:", err);
    return [];
  }
}

// Invalidate cache (called when we modify a user)
function clearModUsersCache() {
  _modUsersCache = [];
}

function filterModUsers(sub) {
  _modUsersSubTab = sub;
  renderModerationTab();
}

function modUsersSearch(val) {
  _modUsersSearch = val || "";
  renderModerationTab();
  setTimeout(function () {
    const input = document.querySelector(".mod-search-input");
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }, 0);
}

// ============================================
// MODERATION — user action dialog
// ============================================
let _modUserActionUid = null;
let _modUserActionDoc = null;

// Opens the action dialog for the given user.
function openModUserAction(uid) {
  const user = _modUsersCache.find(function (u) { return u._uid === uid; });
  if (!user) return;

  _modUserActionUid = uid;
  _modUserActionDoc = user;

  // Populate the dialog
  const name = user.displayName || "Member";
  const email = user.email || "—";
  const initial = name.charAt(0).toUpperCase();

  const avatarEl = document.getElementById("modUserActionAvatar");
  const nameEl = document.getElementById("modUserActionName");
  const emailEl = document.getElementById("modUserActionEmail");
  const titleEl = document.getElementById("modUserActionTitle");

  if (avatarEl) avatarEl.textContent = initial;
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (titleEl) titleEl.textContent = "👤 " + name;

  // Update the button state
  updateModUserVerifyButton();

  // Show
  const modal = document.getElementById("modUserActionModal");
  if (modal) modal.style.display = "flex";

  pushLayer("modUserActionModal", closeModUserAction);
}

// Closes the dialog.
function closeModUserAction() {
  const modal = document.getElementById("modUserActionModal");
  if (modal) modal.style.display = "none";

  _modUserActionUid = null;
  _modUserActionDoc = null;

  popLayer("modUserActionModal");
}

// Paints the verify button based on current state.
function updateModUserVerifyButton() {
  const btn = document.getElementById("modUserVerifyBtn");
  if (!btn || !_modUserActionDoc) return;

  const verified = _modUserActionDoc.verified === true;

  if (verified) {
    btn.textContent = "✕ Remove verification";
    btn.classList.add("verified");
  } else {
    btn.textContent = "✓ Mark as verified";
    btn.classList.remove("verified");
  }
}

// Toggles the verified flag for the current user.
async function toggleUserVerified() {
  if (!_modUserActionUid || !_modUserActionDoc) return;

  const uid = _modUserActionUid;
  const user = _modUserActionDoc;
  const nextState = !(user.verified === true);

  // Confirm before applying
  const verb = nextState ? "verify" : "remove verification from";
  const label = user.displayName || "this user";

  marketaConfirm(
    (nextState ? "✓ Verify" : "✕ Remove verification") + " — " + label,
    nextState
      ? "The user will show a ✓ Verified badge on their listings. You can remove it at any time."
      : "The user will no longer show the ✓ Verified badge.",
    async function () {
      const btn = document.getElementById("modUserVerifyBtn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Saving…";
      }

      try {
        const { db, doc, setDoc } = await getFsModules();

        const payload = {
          verified: nextState,
          verifiedAt: nextState ? Date.now() : null,
          verifiedBy: nextState ? currentUserId : null
        };

        await setDoc(doc(db, "users", uid), payload, { merge: true });

        // Update the local cache
        user.verified = nextState;

        // Invalidate the seller-verified cache so the badge refreshes
        if (typeof invalidateVerifiedCache === "function") {
          invalidateVerifiedCache(uid);
        }

        // Re-render the moderation users list to reflect the change
        renderModerationTab();

        // Re-paint the button
        updateModUserVerifyButton();

        marketaToast(nextState ? "User verified ✓" : "Verification removed");
      } catch (err) {
        console.warn("toggleUserVerified failed:", err);
        marketaAlert("❌ Error", "Couldn't update: " + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    },
    null
  );
}


function modUserCard(u) {
  const name = u.displayName || "Member";
  const email = u.email || "—";
  const initial = name.charAt(0).toUpperCase();
  const joined = u.createdAt ? formatMemberSince(u.createdAt) : "—";
  const cursorStyle = "cursor:pointer;";

  // Role badge
let badge = "";
if (u.isAdmin) {
  badge = '<span class="mod-badge mod-badge-admin">Admin</span>';
} else if (u.isSeller) {
  badge = '<span class="mod-badge mod-badge-seller">Seller</span>';
} else {
  badge = '<span class="mod-badge">Buyer</span>';
}

// Verified tick (prepended before the role badge)
if (u.verified === true) {
  badge = '<span class="mod-badge mod-badge-verified">✓ Verified</span> ' + badge;
}

  return (
  '<div class="mod-user-card" style="' + cursorStyle + '" onclick="openModUserAction(\'' + u._uid + '\')">' +
      '<div class="mod-user-avatar">' + escapeHtml(initial) + '</div>' +
      '<div class="mod-user-info">' +
        '<div class="mod-user-name">' + escapeHtml(name) + '</div>' +
        '<div class="mod-user-email">' + escapeHtml(email) + '</div>' +
        '<div class="mod-user-joined">Joined ' + escapeHtml(joined) + '</div>' +
      '</div>' +
      '<div class="mod-user-badge-wrap">' + badge + '</div>' +
    '</div>'
  );
}

// ============================================
// MODERATION — REPORTS TAB
// ============================================
let _modReportsSubTab = "open";
let _modReportsCache = [];
let _modReportsLoaded = false;

async function renderModReportsPlaceholder(body) {
  body.innerHTML = '<p class="mod-loading">Loading reports…</p>';

  // Force-refresh every time so the latest reports always show
  _modReportsCache = [];
  _modReportsLoaded = false;

  await loadModReports();

  // Sub-tab pills
  const subtabsHtml =
    '<div class="mod-subtabs">' +
      '<button class="mod-subtab ' + (_modReportsSubTab === "open" ? "active" : "") + '" onclick="filterModReports(\'open\')">Open</button>' +
      '<button class="mod-subtab ' + (_modReportsSubTab === "dismissed" ? "active" : "") + '" onclick="filterModReports(\'dismissed\')">Dismissed</button>' +
      '<button class="mod-subtab ' + (_modReportsSubTab === "actioned" ? "active" : "") + '" onclick="filterModReports(\'actioned\')">Actioned</button>' +
      '<button class="mod-subtab ' + (_modReportsSubTab === "all" ? "active" : "") + '" onclick="filterModReports(\'all\')">All</button>' +
    '</div>';

  // Filter
  let shown = _modReportsCache.slice();
  if (_modReportsSubTab !== "all") {
    shown = shown.filter(function (r) { return r.status === _modReportsSubTab; });
  }

  // Sort newest first
  shown.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

  // Counts
  const total = _modReportsCache.length;
  const open = _modReportsCache.filter(function (r) { return r.status === "open"; }).length;

  const countHtml = '<div class="mod-count-line">' + shown.length + ' of ' + total + ' reports · ' + open + ' open</div>';

  // Body
  let html = subtabsHtml + countHtml;

  if (shown.length === 0) {
    html +=
      '<div class="empty-state">' +
        '<div class="empty-state-icon">🚩</div>' +
        '<div class="empty-state-title">No reports here</div>' +
        '<div class="empty-state-text">' + (
          _modReportsSubTab === "open"
            ? "Nice — nothing to review right now."
            : "Nothing in this category."
        ) + '</div>' +
      '</div>';
  } else {
    html += '<div class="mod-cards-list">';
    shown.forEach(function (r) {
      html += modReportCard(r);
    });
    html += '</div>';
  }

  body.innerHTML = html;
}

async function loadModReports() {
  if (_modReportsLoaded) return _modReportsCache;

  try {
    const { db, collection, getDocs } = await getFsModules();
    const snap = await getDocs(collection(db, "reports"));
    const items = [];
    snap.forEach(function (docSnap) {
      const data = docSnap.data();
      data._docId = docSnap.id;
      items.push(data);
    });
    _modReportsCache = items;
    _modReportsLoaded = true;
    return items;
  } catch (err) {
    console.warn("Failed to load reports:", err);
    _modReportsCache = [];
    _modReportsLoaded = true;
    return [];
  }
}

function filterModReports(sub) {
  _modReportsSubTab = sub;
  renderModerationTab();
}

function modReportCard(r) {
  const typeLabel = r.type === "listing" ? "📦 Listing" : "👤 User";
  const targetName = r.targetName || "(unknown)";
  const details = r.details
    ? '<div class="mod-card-row">📝 ' + escapeHtml(r.details) + '</div>'
    : "";
  const reporter = r.reportedByName || r.reportedBy || "—";

  // Status badge
  let badge = "";
  if (r.status === "open") {
    badge = '<span class="mod-badge mod-badge-open">🚩 Open</span>';
  } else if (r.status === "dismissed") {
    badge = '<span class="mod-badge">Dismissed</span>';
  } else if (r.status === "actioned") {
    badge = '<span class="mod-badge mod-badge-released">✅ Actioned</span>';
  }

  // Actions based on status
  let actions = "";
  if (r.status === "open") {
    actions =
      '<button class="mod-action-btn mod-action-neutral" onclick="viewReportedListing(\'' + r._docId + '\')">👁 View</button>' +
      '<button class="mod-action-btn mod-action-refund" onclick="actionReport(\'' + r._docId + '\', \'actioned\')">✅ Action</button>' +
      '<button class="mod-action-btn" style="background:#888;" onclick="actionReport(\'' + r._docId + '\', \'dismissed\')">✕ Dismiss</button>';
  }

  return (
    '<div class="mod-card">' +
      '<div class="mod-card-header">' +
        '<span class="mod-card-title">' + escapeHtml(typeLabel) + ' — ' + escapeHtml(targetName) + '</span>' +
        badge +
      '</div>' +
      '<div class="mod-card-row">⚠️ Reason: <strong>' + escapeHtml(r.reason || "—") + '</strong></div>' +
      details +
      '<div class="mod-card-row">👤 Reported by: ' + escapeHtml(reporter) + '</div>' +
      '<div class="mod-card-row mod-card-time">📅 ' + escapeHtml(r.createdAtStr || "") + '</div>' +
      (actions ? '<div class="mod-card-actions">' + actions + '</div>' : "") +
    '</div>'
  );
}

// Opens the reported listing in the detail modal (admin view)
// Note: we do NOT close the moderation panel — it stays open
// underneath, so closing the detail returns the admin to reports.
function viewReportedListing(reportDocId) {
  const r = _modReportsCache.find(function (x) { return x._docId === reportDocId; });
  if (!r) return;

  if (r.type === "listing") {
    const idx = allListingsCache.findIndex(function (l) { return l.id === r.targetId; });

    // If the listing isn't in the cache, try loading it fresh
    if (idx >= 0) {
      showDetail(idx);
    } else {
      marketaAlert(
        "Listing not found",
        "This listing may have been deleted or is not currently visible."
      );
    }
  } else {
    marketaAlert("User profiles", "Viewing other users' full profiles isn't built yet.");
  }
}

// Updates a report's status.
// If newStatus is "actioned" AND the report is for a listing,
// we also hide the listing from public view (soft delete).
async function actionReport(reportDocId, newStatus) {
  const r = _modReportsCache.find(function (x) { return x._docId === reportDocId; });
  if (!r) return;

  const isListing = r.type === "listing";
  const isActioning = newStatus === "actioned";
  const shouldHideListing = isListing && isActioning;

  // Build the confirmation message
  let title, message;
  if (shouldHideListing) {
    title = "🚫 Remove this listing?";
    message = "This will hide the reported listing from buyers on Marketa.\n\n" +
              "The seller will still see it in their My Listings, marked as removed.\n\n" +
              "You can reverse this later if needed.";
  } else if (isActioning) {
    title = "✅ Mark as actioned?";
    message = "Mark this report as actioned?";
  } else {
    title = "Dismiss report?";
    message = "Dismiss this report? The listing will stay visible.";
  }

  marketaConfirm(title, message, async function () {
    try {
      const { db, doc, updateDoc, setDoc, getDoc } = await getFsModules();

      // 1. If we're actioning a listing report → hide the listing
      if (shouldHideListing) {
        // Fetch the latest listing doc (in case cache is stale)
        const listingRef = doc(db, "listings", String(r.targetId));
        const listingSnap = await getDoc(listingRef);

        if (listingSnap.exists()) {
          const listingData = listingSnap.data();
          listingData.hidden = true;
          listingData.hiddenAt = Date.now();
          listingData.hiddenReason = r.reason || "Reported and actioned";
          listingData.hiddenByReport = reportDocId;
          await setDoc(listingRef, listingData);
        } else {
          console.warn("Listing not found — it may have been deleted already.");
        }
      }

      // 2. Update the report status
      await updateDoc(doc(db, "reports", reportDocId), {
        status: newStatus,
        reviewedBy: currentUserId || "admin",
        reviewedAt: Date.now(),
        reviewedAtStr: new Date().toLocaleString(),
        listingHidden: shouldHideListing
      });

      // 3. Update local caches — both the filtered view AND the raw cache
r.status = newStatus;

if (shouldHideListing) {
  // Update the filtered cache
  const localListing = allListingsCache.find(function (l) { return String(l.id) === String(r.targetId); });
  if (localListing) localListing.hidden = true;

  // Also update the RAW cache — recomputeFilteredListings reads from it
  const rawListing = allListingsRawCache.find(function (l) { return String(l.id) === String(r.targetId); });
  if (rawListing) rawListing.hidden = true;

  // Recompute the filtered view so nothing stale lingers
  recomputeFilteredListings();
}

// Refresh the moderation tab
renderModerationTab();

// Refresh the homepage grid if visible
const listingsDiv = document.querySelector(".listings");
if (listingsDiv) renderListings(allListingsCache);

// Refresh the browse page if it's open
const browseOpen = document.getElementById("browsePage").style.display === "flex";
if (browseOpen && typeof applyBrowseFilters === "function") {
  applyBrowseFilters();
}

// Refresh the search page if it's open
const searchOpen = document.getElementById("searchPage").style.display === "flex";
if (searchOpen && typeof searchPageQuery === "function") {
  searchPageQuery();
}

      // Show confirmation
      if (shouldHideListing) {
        marketaToast("Report actioned · listing removed ✅");
      } else {
        marketaToast("Report " + newStatus);
      }
    } catch (err) {
      marketaAlert("❌ Error", "Couldn't update: " + err.message);
    }
  }, null);
}

// ============================================
// TICKETS — live subscription
// ============================================
// Keeps both the user's My Tickets cache and the admin's
// moderation Tickets cache up to date in real time.

let _ticketsUnsubscribe = null;

async function subscribeToTickets() {
  if (_ticketsUnsubscribe) {
    try { _ticketsUnsubscribe(); } catch (e) {}
    _ticketsUnsubscribe = null;
  }
  if (!currentAuthUser) return;

  try {
    const { db, collection, onSnapshot } = await getFsModules();
    _ticketsUnsubscribe = onSnapshot(
      collection(db, "tickets"),
      function (snap) {
        const allTickets = [];
        snap.forEach(function (d) {
          const data = d.data();
          data._docId = d.id;
          allTickets.push(data);
        });

        // --- Update the admin cache (all tickets) ---
        _modTicketsCache = allTickets;
        _modTicketsLoaded = true;

        // --- Update the user's own cache ---
        _myTicketsCache = allTickets.filter(function (t) {
          return t.userId === currentUserId;
        });

        // --- Refresh the admin Tickets tab if it's open ---
        const modPage = document.getElementById("moderationPage");
        const modOpen = modPage && modPage.style.display === "flex";
        if (modOpen && _moderationTab === "tickets") {
          renderModerationTab();
        }

        // --- Refresh the My Tickets page if it's open ---
        const ticketsPage = document.getElementById("myTicketsPage");
        const ticketsOpen = ticketsPage && ticketsPage.style.display === "flex";
        if (ticketsOpen) {
          renderMyTickets();
        }

        // --- Refresh the open ticket detail page ---
        const detailPage = document.getElementById("ticketDetailPage");
        const detailOpen = detailPage && detailPage.style.display === "flex";
        if (detailOpen && _currentTicketId) {
          const updated = allTickets.find(function (t) { return t._docId === _currentTicketId; });
          if (updated) {
            _currentTicketData = updated;
            // Re-render the thread
            renderTicketMessages(updated);
            // Update the status badge
            const statusEl = document.getElementById("ticketDetailStatus");
            if (statusEl) {
              const statusLabel = updated.status === "resolved"
                ? "Resolved"
                : updated.status === "awaiting_user"
                  ? "Awaiting user"
                  : "Open";
              statusEl.textContent = statusLabel;
              statusEl.className = "ticket-row-status ticket-status-" + (updated.status || "open");
            }
          }
        }

        // --- Update the Support modal badge ---
        if (typeof updateMyTicketsBadge === "function") {
          updateMyTicketsBadge();
        }
      },
      function (err) {
        console.warn("Tickets subscription error:", err);
      }
    );
  } catch (err) {
    console.warn("Could not subscribe to tickets:", err);
  }
}

// ============================================
// MODERATION — TICKETS TAB
// ============================================
let _modTicketsSubTab = "open";
let _modTicketsSearch = "";
let _modTicketsCache = [];
let _modTicketsLoaded = false;

async function renderModTicketsPlaceholder(body) {
  body.innerHTML = '<p class="mod-loading">Loading tickets…</p>';

  // Force-refresh every time so the latest tickets show
  _modTicketsCache = [];
  _modTicketsLoaded = false;

  await loadModTickets();

  // Sub-tab pills
  const subtabsHtml =
    '<div class="mod-subtabs">' +
      '<button class="mod-subtab ' + (_modTicketsSubTab === "open" ? "active" : "") + '" onclick="filterModTickets(\'open\')">Open</button>' +
      '<button class="mod-subtab ' + (_modTicketsSubTab === "awaiting" ? "active" : "") + '" onclick="filterModTickets(\'awaiting\')">Awaiting reply</button>' +
      '<button class="mod-subtab ' + (_modTicketsSubTab === "resolved" ? "active" : "") + '" onclick="filterModTickets(\'resolved\')">Resolved</button>' +
      '<button class="mod-subtab ' + (_modTicketsSubTab === "all" ? "active" : "") + '" onclick="filterModTickets(\'all\')">All</button>' +
    '</div>';

  // Search bar
  const searchHtml =
    '<div class="mod-search-wrap">' +
      '<span class="mod-search-icon">🔍</span>' +
      '<input type="text" class="mod-search-input" placeholder="Search subject, user name or email..." value="' + escapeHtml(_modTicketsSearch) + '" oninput="modTicketsSearch(this.value)">' +
    '</div>';

  // Filter by sub-tab
  let shown = _modTicketsCache.slice();

  if (_modTicketsSubTab === "open") {
    shown = shown.filter(function (t) { return t.status !== "resolved"; });
  } else if (_modTicketsSubTab === "awaiting") {
    // Awaiting reply = last message is from the user (admin needs to respond)
    shown = shown.filter(function (t) {
      if (t.status === "resolved") return false;
      const msgs = t.messages || [];
      const last = msgs[msgs.length - 1];
      return last && last.from === "user";
    });
  } else if (_modTicketsSubTab === "resolved") {
    shown = shown.filter(function (t) { return t.status === "resolved"; });
  }

  // Search filter
  if (_modTicketsSearch) {
    const q = _modTicketsSearch.toLowerCase();
    shown = shown.filter(function (t) {
      const subj = (t.subject || "").toLowerCase();
      const name = (t.userName || "").toLowerCase();
      const email = (t.userEmail || "").toLowerCase();
      return subj.includes(q) || name.includes(q) || email.includes(q);
    });
  }

  // Sort newest activity first
  shown.sort(function (a, b) {
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });

  // Counts
  const total = _modTicketsCache.length;
  const openCount = _modTicketsCache.filter(function (t) { return t.status !== "resolved"; }).length;
  const unreadCount = _modTicketsCache.filter(function (t) {
  return t.unreadForAdmin === true && t.status !== "resolved";
}).length;

  const countHtml =
    '<div class="mod-count-line">' +
      shown.length + ' of ' + total + ' tickets · ' +
      openCount + ' open · ' +
      (unreadCount > 0 ? '<strong style="color:#d9534f;">' + unreadCount + ' unread</strong>' : '0 unread') +
    '</div>';

  // Body
  let html = subtabsHtml + searchHtml + countHtml;

  if (shown.length === 0) {
    let emptyTitle = "No tickets here";
    let emptyText = "Nothing in this category.";
    if (_modTicketsSubTab === "open") {
      emptyTitle = "No open tickets";
      emptyText = "Nice — no one needs support right now.";
    } else if (_modTicketsSubTab === "awaiting") {
      emptyTitle = "Nothing awaiting your reply";
      emptyText = "You're caught up.";
    } else if (_modTicketsSubTab === "resolved") {
      emptyTitle = "No resolved tickets";
      emptyText = "Tickets you've closed will appear here.";
    }

    html +=
      '<div class="empty-state">' +
        '<div class="empty-state-icon">🎫</div>' +
        '<div class="empty-state-title">' + emptyTitle + '</div>' +
        '<div class="empty-state-text">' + emptyText + '</div>' +
      '</div>';
  } else {
    html += '<div class="mod-cards-list">';
    shown.forEach(function (t) {
      html += modTicketCard(t);
    });
    html += '</div>';
  }

  body.innerHTML = html;
}

// Load all tickets from Firestore (no userId filter — admin sees everything).
async function loadModTickets() {
  if (_modTicketsLoaded) return _modTicketsCache;

  try {
    const { db, collection, getDocs } = await getFsModules();
    const snap = await getDocs(collection(db, "tickets"));
    const items = [];
    snap.forEach(function (docSnap) {
      const data = docSnap.data();
      data._docId = docSnap.id;
      items.push(data);
    });
    _modTicketsCache = items;
    _modTicketsLoaded = true;
    return items;
  } catch (err) {
    console.warn("Failed to load tickets:", err);
    _modTicketsCache = [];
    _modTicketsLoaded = true;
    return [];
  }
}

function filterModTickets(sub) {
  _modTicketsSubTab = sub;
  renderModerationTab();
}

function modTicketsSearch(val) {
  _modTicketsSearch = val || "";
  renderModerationTab();
  // Keep focus in the search input after re-render
  setTimeout(function () {
    const input = document.querySelector(".mod-search-input");
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }, 0);
}

// Build a single ticket card for the admin list.
function modTicketCard(ticket) {
  const subject = ticket.subject || "(no subject)";
  const userName = ticket.userName || "User";
  const userEmail = ticket.userEmail || "";
  const categoryLabel = ticket.categoryLabel || "🎫 Ticket";
  const timeText = ticket.createdAtStr || "";

  // Last message preview
  const msgs = ticket.messages || [];
  const last = msgs[msgs.length - 1];
  let preview = "No messages";
  if (last) {
    if (last.text) preview = last.text;
    else if (last.img) preview = "📷 Photo";
  }
  if (preview.length > 70) preview = preview.slice(0, 70) + "…";

  // Status badge
  let statusBadge = "";
  if (ticket.status === "resolved") {
    statusBadge = '<span class="mod-badge mod-badge-released">✅ Resolved</span>';
  } else if (ticket.status === "awaiting_user") {
    statusBadge = '<span class="mod-badge">⏳ Awaiting user</span>';
  } else {
    statusBadge = '<span class="mod-badge mod-badge-open">🚩 Open</span>';
  }

  // Unread badge — never show on resolved tickets
const unreadBadge = (ticket.unreadForAdmin === true && ticket.status !== "resolved")
  ? '<span style="background:#d9534f;color:white;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;letter-spacing:0.4px;margin-left:6px;">NEW</span>'
  : '';

  return (
    '<div class="mod-card" style="cursor:pointer;" onclick="openTicketFromAdmin(\'' + ticket._docId + '\')">' +
      '<div class="mod-card-header">' +
        '<span class="mod-card-title">' + escapeHtml(subject) + unreadBadge + '</span>' +
        statusBadge +
      '</div>' +
      '<div class="mod-card-row">' + escapeHtml(categoryLabel) + '</div>' +
      '<div class="mod-card-row">👤 ' + escapeHtml(userName) +
        (userEmail ? ' · ' + escapeHtml(userEmail) : '') +
      '</div>' +
      '<div class="mod-card-row" style="color:var(--text-gray);">' + escapeHtml(preview) + '</div>' +
      '<div class="mod-card-row mod-card-time">📅 ' + escapeHtml(timeText) + '</div>' +
    '</div>'
  );
}

// Opens the ticket detail page in admin mode.
function openTicketFromAdmin(ticketDocId) {
  // Load the ticket into the user-side cache first (so the detail
  // page can find it).
  if (!_myTicketsCache) _myTicketsCache = [];
  const existing = _myTicketsCache.find(function (t) { return t._docId === ticketDocId; });
  if (!existing) {
    const fromAdmin = _modTicketsCache.find(function (t) { return t._docId === ticketDocId; });
    if (fromAdmin) _myTicketsCache.push(fromAdmin);
  }

  // Hide the moderation panel visually (kept in the layer stack so
  // back button returns here after closing the ticket).
  const modPage = document.getElementById("moderationPage");
  if (modPage) modPage.style.display = "none";

  // Open the detail in ADMIN mode
  openTicketDetail(ticketDocId, { admin: true });
}

// ============================================
// MODERATION — MODERATORS TAB
// ============================================
let _moderatorsCache = [];
let _moderatorsLoaded = false;

async function renderModModeratorsPlaceholder(body) {
  // Show loading the first time
  body.innerHTML = '<p class="mod-loading">Loading moderators…</p>';

  await loadModerators();

  const count = _moderatorsCache.length;

  // Build the info card
  const infoHtml =
    '<div class="mod-info-card">' +
      '<div class="mod-info-icon">🛡️</div>' +
      '<div>' +
        '<div class="mod-info-title">Who can moderate</div>' +
        '<div class="mod-info-text">Moderators listed here can review disputes, oversee every order, and manage users. Add a colleague\'s email below and they get access the next time they sign in.</div>' +
      '</div>' +
    '</div>';

  // Build the add form
  const formHtml =
    '<div class="mod-add-card">' +
      '<label class="mod-add-label">Email address</label>' +
      '<div class="mod-add-input-wrap">' +
        '<span class="mod-add-icon">✉️</span>' +
        '<input type="email" id="modAddEmailInput" class="mod-add-input" placeholder="teammate@example.com" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
      '</div>' +
      '<button class="mod-add-btn" onclick="addModeratorByEmail()">🛡️ Add moderator</button>' +
      '<div id="modAddError" class="mod-add-error" style="display:none;"></div>' +
    '</div>';

  // Build the current moderators heading
  const headingHtml =
    '<div class="mod-moderators-heading">' +
      '<span class="mod-moderators-title">Current moderators</span>' +
      '<span class="mod-moderators-count">' + count + ' moderator' + (count === 1 ? '' : 's') + '</span>' +
    '</div>';

  // Build the moderator cards
  let cardsHtml = '<div class="mod-cards-list">';
  if (_moderatorsCache.length === 0) {
    cardsHtml +=
      '<div class="empty-state">' +
        '<div class="empty-state-icon">🛡️</div>' +
        '<div class="empty-state-title">No moderators yet</div>' +
        '<div class="empty-state-text">Add one above to get started.</div>' +
      '</div>';
  } else {
    _moderatorsCache.forEach(function (m) {
      cardsHtml += modModeratorCard(m, count);
    });
  }
  cardsHtml += '</div>';

  body.innerHTML = infoHtml + formHtml + headingHtml + cardsHtml;
}

// Load moderators from Firestore
async function loadModerators() {
  if (_moderatorsLoaded) return _moderatorsCache;

  try {
    const { db, collection, getDocs } = await getFsModules();
    const snap = await getDocs(collection(db, "moderators"));
    const items = [];
    snap.forEach(function (docSnap) {
      const data = docSnap.data();
      data._docId = docSnap.id;
      items.push(data);
    });
    // Sort newest added first
    items.sort(function (a, b) {
      return (b.addedAt || 0) - (a.addedAt || 0);
    });
    _moderatorsCache = items;
    _moderatorsLoaded = true;
    return items;
  } catch (err) {
    console.warn("Failed to load moderators:", err);
    _moderatorsCache = [];
    _moderatorsLoaded = true;
    return [];
  }
}

function modModeratorCard(m, totalCount) {
  const email = m.email || "—";
  const initial = email.charAt(0).toUpperCase();
  const isOwnerRow = m.isOwner === true || (m.addedBy === OWNER_UID && totalCount <= 1);
  const isOnlyOne = totalCount <= 1;

  // Locked badge if this is the owner OR the last moderator
  const lockedBadge = (isOwnerRow || isOnlyOne)
    ? '<span class="mod-locked-badge">🔒 Locked</span>'
    : '';

  // Remove button (only if not owner, and more than 1)
  const canRemove = !isOwnerRow && !isOnlyOne;
  const removeBtn = canRemove
    ? '<button class="mod-remove-btn" onclick="removeModerator(\'' + escapeHtml(m._docId) + '\', \'' + escapeHtml(email) + '\')">Remove</button>'
    : '';

  // Subtext: "Owner" for the owner, else "Full moderation access"
  const subtext = isOwnerRow ? "Platform owner" : "Full moderation access";

  return (
    '<div class="mod-moderator-card">' +
      '<div class="mod-moderator-avatar">' + escapeHtml(initial) + '</div>' +
      '<div class="mod-moderator-info">' +
        '<div class="mod-moderator-email">' + escapeHtml(email) + '</div>' +
        '<div class="mod-moderator-sub">' + subtext + '</div>' +
      '</div>' +
      '<div class="mod-moderator-actions">' +
        lockedBadge +
        removeBtn +
      '</div>' +
    '</div>'
  );
}

// Add a moderator by email
async function addModeratorByEmail() {
  // Only the platform owner can add moderators
  if (!isCurrentUserOwner()) {
    marketaAlert("Owner only", "Only the platform owner can manage moderators.");
    return;
  }
  
  const input = document.getElementById("modAddEmailInput");
  const errEl = document.getElementById("modAddError");
  if (!input || !errEl) return;

  errEl.style.display = "none";

  const rawEmail = (input.value || "").trim();
  const email = rawEmail.toLowerCase();

  if (!email) {
    errEl.textContent = "Please enter an email address.";
    errEl.style.display = "block";
    return;
  }

  // Simple email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = "That doesn't look like a valid email address.";
    errEl.style.display = "block";
    return;
  }

  // Check not already added
  const exists = _moderatorsCache.some(function (m) {
    return (m.email || "").toLowerCase() === email;
  });
  if (exists) {
    errEl.textContent = "That email is already a moderator.";
    errEl.style.display = "block";
    return;
  }

  try {
    const { db, doc, setDoc } = await getFsModules();

    const entry = {
      email: email,
      addedBy: currentUserId || "unknown",
      addedAt: Date.now()
    };

    await setDoc(doc(db, "moderators", email), entry);

    // Update cache
    entry._docId = email;
    _moderatorsCache.unshift(entry);

    // Clear input
    input.value = "";

    // Refresh the tab
    renderModerationTab();

    marketaToast("Moderator added ✅");
  } catch (err) {
    errEl.textContent = "Couldn't add moderator: " + (err.message || "unknown error");
    errEl.style.display = "block";
  }
}

// Remove a moderator
async function removeModerator(docId, email) {
  // Only the platform owner can remove moderators
  if (!isCurrentUserOwner()) {
    marketaAlert("Owner only", "Only the platform owner can manage moderators.");
    return;
  }
  
  // Safety: can't remove the last one
  if (_moderatorsCache.length <= 1) {
    marketaAlert("🔒 Locked", "You can't remove the last moderator — this would lock you out of the moderation panel.");
    return;
  }

  marketaConfirm(
    "Remove moderator",
    "Remove \"" + email + "\" from moderators?\n\nThey will lose moderation access the next time they sign in.",
    async function () {
      try {
        const { db, doc, deleteDoc, collection, getDocs, query, where, setDoc } = await getFsModules();

        // 1. Delete from the moderators collection
        await deleteDoc(doc(db, "moderators", docId));

        // 2. If there's a user with this email, flip their isAdmin to false
        try {
          const q = query(collection(db, "users"), where("email", "==", email));
          const snap = await getDocs(q);
          for (const userDoc of snap.docs) {
            const userData = userDoc.data();
            await setDoc(doc(db, "users", userDoc.id), Object.assign({}, userData, { isAdmin: false }));
          }
        } catch (e) {
          console.warn("Couldn't update users collection:", e);
        }

        // Update cache
        _moderatorsCache = _moderatorsCache.filter(function (m) {
          return (m.email || "").toLowerCase() !== email.toLowerCase();
        });

        // Refresh
        renderModerationTab();

        marketaToast("Moderator removed");
      } catch (err) {
        marketaAlert("❌ Error", "Couldn't remove moderator: " + err.message);
      }
    },
    null
  );
}
// ============================================
// AUTO-GRANT ADMIN FOR MODERATORS (by email)
// ============================================
// Called on sign-in. Checks whether this user's email is
// in the `moderators` collection, and if so, flips
// isAdmin: true on their users/{uid} doc.
async function applyModeratorAccessForUser(user) {
  if (!user || !user.email) return;

  const email = user.email.toLowerCase();

  try {
    const { db, doc, getDoc, setDoc } = await getFsModules();

    // --- OWNER BOOTSTRAP ---
    // If this is the platform owner, ensure they are always
    // in the moderators collection with isAdmin: true.
    if (user.uid === OWNER_UID) {
      // 1. Ensure the moderators doc exists
      const ownerModSnap = await getDoc(doc(db, "moderators", email));
      if (!ownerModSnap.exists()) {
        await setDoc(doc(db, "moderators", email), {
          email: email,
          addedBy: user.uid,
          addedAt: Date.now(),
          isOwner: true
        });
      }
      // 2. Ensure the user doc has isAdmin: true
      const ownerUserSnap = await getDoc(doc(db, "users", user.uid));
      const alreadyAdmin = ownerUserSnap.exists() && ownerUserSnap.data().isAdmin === true;
      if (!alreadyAdmin) {
        await setDoc(doc(db, "users", user.uid), { isAdmin: true }, { merge: true });
      }
      _isAdminCache = true;
      return;
    }

    // --- REGULAR MODERATOR CHECK ---
    // 1. Is this email in the moderators collection?
    const modSnap = await getDoc(doc(db, "moderators", email));
    if (!modSnap.exists()) return;

    // 2. Yes — is this user already marked admin?
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const isAdmin = userSnap.exists() && userSnap.data().isAdmin === true;
    if (isAdmin) return;

    // 3. Flip isAdmin: true on their user doc
    await setDoc(doc(db, "users", user.uid), { isAdmin: true }, { merge: true });

    // 4. Update the cache so the drawer shows the Moderation row next time
    _isAdminCache = true;
  } catch (err) {
    console.warn("applyModeratorAccessForUser failed:", err);
  }
}
// ============================================
// DRAWER NAVIGATION — routes drawer taps through
// the same logic as the bottom nav, so highlighting
// and page transitions stay consistent.
// ============================================
function drawerNavTo(tab) {
  // Close the drawer if it's still open (safety)
  const drawer = document.getElementById("mainDrawer");
  if (drawer && drawer.classList.contains("show")) {
    closeDrawer();
  }

  // Hand off to the bottom nav's handler — it closes
  // open pages, sets the highlight, and opens the target.
  bottomNavGo(tab);
}
/* ============================================
   SESSION A — SELL WIZARD FUNCTIONS
   ============================================ */

// Repaint the wizard: highlights the correct step, shows the right panel,
// updates the nav buttons.
function renderSellStep() {
  // 1. Update step indicator
  document.querySelectorAll(".sell-step").forEach(function (el) {
    const n = Number(el.getAttribute("data-step"));
    el.classList.remove("active", "done");
    if (n === currentSellStep) el.classList.add("active");
    else if (n < currentSellStep) el.classList.add("done");
  });

  // 2. Show the right panel
  for (let i = 1; i <= 4; i++) {
    const panel = document.getElementById("sellStep" + i);
    if (panel) panel.style.display = (i === currentSellStep) ? "block" : "none";
  }

  // 3. Back button visible from step 2 onwards
  const backBtn = document.getElementById("sellBackBtn");
  if (backBtn) backBtn.style.display = (currentSellStep > 1) ? "block" : "none";

  // 4. Next button text + style
  const nextBtn = document.getElementById("sellNextBtn");
  if (nextBtn) {
    if (currentSellStep === 4) {
      nextBtn.textContent = _sellPublishMode ? "Save Changes" : "Publish ad";
      nextBtn.classList.add("publish");
    } else {
      nextBtn.textContent = "Continue →";
      nextBtn.classList.remove("publish");
    }
  }

  // 5. Header title
  const headerEl = document.getElementById("sellHeaderTitle");
  if (headerEl) {
    headerEl.textContent = _sellPublishMode ? "Edit Listing" : "Post Your Listing";
  }
}

// Move forward. Step 4 = publish.
function sellGoNext() {
  if (!validateSellStep(currentSellStep)) return;

  if (currentSellStep < 4) {
  currentSellStep++;
  if (currentSellStep === 4) buildReviewCard();
  renderSellStep();
    // Auto-scroll the modal body to top
    const body = document.querySelector(".sell-body");
    if (body) body.scrollTop = 0;
  } else {
    // Final step — publish
    postListing();
  }
}

// Move backward.
function sellGoBack() {
  if (currentSellStep > 1) {
    currentSellStep--;
    renderSellStep();
    const body = document.querySelector(".sell-body");
    if (body) body.scrollTop = 0;
  }
}

// Validate only the current step's fields before letting the user proceed.
function validateSellStep(step) {
  if (step === 1) {
    const cat = document.getElementById("itemCategory").value;
    const cond = document.getElementById("itemCondition").value;
    const name = document.getElementById("itemName").value.trim();
    const desc = document.getElementById("itemDescription").value.trim();

    if (!cat)  { marketaAlert("Missing category", "Please choose a category. 🙏"); return false; }
    if (!cond) { marketaAlert("Missing condition", "Please choose a condition. 🙏"); return false; }
    if (name.length < 8) { marketaAlert("Title too short", "Ad title needs at least 8 characters."); return false; }
    if (desc.length < 20) { marketaAlert("Description too short", "Description needs at least 20 characters."); return false; }
    return true;
  }

  if (step === 2) {
    if (currentPhotos.length === 0) {
      marketaAlert("Add a photo", "Please add at least 1 photo of your item. 📷");
      return false;
    }
    return true;
  }

  if (step === 3) {
  const price = document.getElementById("itemPrice").value;
  const loc   = document.getElementById("itemLocation").value.trim();
  const region = document.getElementById("itemRegion").value;
  const qtyEl = document.getElementById("itemQuantity");
  const qty = qtyEl ? Number(qtyEl.value) : 1;

  if (!price || Number(price) <= 0) { marketaAlert("Invalid price", "Please enter a valid price (a positive number). 🙏"); return false; }
  if (Number(price) > 10000000) { marketaAlert("Price too high", "Price can't exceed GH₵ 10,000,000. 🙏"); return false; }
  if (!qty || qty < 1 || !Number.isFinite(qty)) { marketaAlert("Invalid quantity", "Quantity must be at least 1. 🙏"); return false; }
  if (qty > 9999) { marketaAlert("Quantity too high", "Quantity can't exceed 9,999. 🙏"); return false; }
  if (!loc) { marketaAlert("Missing location", "Please enter your area or town. 🙏"); return false; }
  if (!region) { marketaAlert("Missing region", "Please choose your region. 🙏"); return false; }
  return true;
}

  return true; // step 4 = no validation needed
}

// Build the review card on step 4.
function buildReviewCard() {
  const card = document.getElementById("sellReviewCard");
  if (!card) return;

  const name     = document.getElementById("itemName").value.trim();
  const price    = Number(document.getElementById("itemPrice").value) || 0;
  const loc      = document.getElementById("itemLocation").value.trim();
  const region   = document.getElementById("itemRegion").value;
  const cond     = document.getElementById("itemCondition").value;
  const cat      = document.getElementById("itemCategory").value;
  const desc     = document.getElementById("itemDescription").value.trim();
  const negotiable = document.getElementById("itemNegotiable").checked;

  const firstPhoto = currentPhotos[0] || null;

  card.innerHTML =
    '<div class="sell-review-photo">' +
      (firstPhoto ? '<img src="' + firstPhoto + '" alt="">' : '📦') +
    '</div>' +
    '<div class="sell-review-body">' +
      '<div class="sell-review-price">GH₵ ' + price.toLocaleString() + '</div>' +
      '<div class="sell-review-title">' + escapeHtml(formatTitle(name)) + '</div>' +
      '<div class="sell-review-meta">' +
     '<span>' + locationIcon() + ' ' + escapeHtml(loc) + (region ? ', ' + escapeHtml(region) : '') + '</span>' +
        '<span>' + escapeHtml(cond || '') + '</span>' +
      '</div>' +
      (negotiable ? '<div class="sell-review-meta"><span>💬 Price negotiable</span></div>' : '') +
      '<div class="sell-review-desc">' + escapeHtml(desc) + '</div>' +
      buildReviewDetailsHtml() +
    '</div>';
}
// Live character counters for the title + description.
function updateSellCounters() {
  const nameEl = document.getElementById("itemName");
  const descEl = document.getElementById("itemDescription");
  const titleC = document.getElementById("titleCounter");
  const descC  = document.getElementById("descCounter");

  if (nameEl && titleC) {
    titleC.textContent = nameEl.value.length + "/90 characters — write at least 8.";
  }
  if (descEl && descC) {
    descC.textContent = descEl.value.length + "/1500 characters.";
  }
}

// Attach live counter + auto-advance listeners once the page loads.
window.addEventListener("load", function () {
  const nameEl = document.getElementById("itemName");
  const descEl = document.getElementById("itemDescription");
  if (nameEl) nameEl.addEventListener("input", updateSellCounters);
  if (descEl) descEl.addEventListener("input", updateSellCounters);
  
  // Wire up the category → sub-category dropdown
const catEl = document.getElementById("itemCategory");
if (catEl && catEl.dataset.subWired !== "yes") {
  catEl.dataset.subWired = "yes";
  catEl.addEventListener("change", function () {
    updateSubCategoryDropdown();
  });
}

  // When entering step 4, build the review card
  const nextBtn = document.getElementById("sellNextBtn");
  if (nextBtn) {
    const originalClick = nextBtn.onclick;
    // We can't easily override onclick set in HTML, so instead we hook
    // into sellGoNext via a wrapper is not needed — we handle it in sellGoNext.
  }
});
/* ============================================
   SESSION B — DETAILS TABLE (spec rows)
   ============================================ */

const SELL_DETAILS_MAX = 6;

// Returns an array of { label, value } from the current rows.
// Empty rows (missing label OR value) are dropped.
function getDetailRows() {
  const rows = document.querySelectorAll(".sell-detail-row");
  const out = [];
  rows.forEach(function (row) {
    const label = (row.querySelector(".sell-detail-label") || {}).value || "";
    const value = (row.querySelector(".sell-detail-value") || {}).value || "";
    const trimmedLabel = label.trim();
    const trimmedValue = value.trim();
    if (trimmedLabel && trimmedValue) {
      out.push({ label: trimmedLabel, value: trimmedValue });
    }
  });
  return out;
}

// Adds one row to the Details section.
function addDetailRow(prefillLabel, prefillValue) {
  const container = document.getElementById("sellDetailsRows");
  if (!container) return;

  const currentCount = container.querySelectorAll(".sell-detail-row").length;
  if (currentCount >= SELL_DETAILS_MAX) return;

  const row = document.createElement("div");
  row.className = "sell-detail-row";

  const labelWrap = document.createElement("div");
  labelWrap.className = "sell-detail-label-wrap";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "sell-detail-label";
  labelInput.placeholder = "Label";
  labelInput.maxLength = 30;
  labelInput.autocomplete = "off";
  if (prefillLabel) labelInput.value = prefillLabel;

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "sell-detail-value";
  valueInput.placeholder = "Value";
  valueInput.maxLength = 60;
  valueInput.autocomplete = "off";
  if (prefillValue) valueInput.value = prefillValue;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "sell-detail-delete";
  deleteBtn.setAttribute("aria-label", "Delete row");
  deleteBtn.textContent = "🗑";
  deleteBtn.addEventListener("click", function () {
    row.remove();
    updateAddRowButtonState();
  });

  labelWrap.appendChild(labelInput);
  row.appendChild(labelWrap);
  row.appendChild(valueInput);
  row.appendChild(deleteBtn);

  // Wire up the suggestion dropdown for this label input
  attachLabelSuggestion(labelInput, labelWrap, valueInput);

  container.appendChild(row);
  updateAddRowButtonState();
}

// Enables/disables the "+ Add row" button based on row count.
function updateAddRowButtonState() {
  const container = document.getElementById("sellDetailsRows");
  const btn = document.getElementById("sellAddRowBtn");
  if (!container || !btn) return;

  const count = container.querySelectorAll(".sell-detail-row").length;
  if (count >= SELL_DETAILS_MAX) {
    btn.disabled = true;
    btn.textContent = "Maximum 6 rows reached";
  } else {
    btn.disabled = false;
    btn.textContent = "+ Add row";
  }
}

// Clears all rows (used when opening a fresh sell form).
function clearDetailRows() {
  const container = document.getElementById("sellDetailsRows");
  if (container) container.innerHTML = "";
  updateAddRowButtonState();
}

// Loads existing rows from a listing (used on Edit).
function loadDetailRows(details) {
  clearDetailRows();
  if (!details || !Array.isArray(details)) return;
  details.slice(0, SELL_DETAILS_MAX).forEach(function (d) {
    addDetailRow(d.label || "", d.value || "");
  });
}
/* ============================================
   SESSION B — LABEL SUGGESTIONS
   ============================================ */

// Category → list of common labels
const SELL_LABEL_SUGGESTIONS = {
  "📱 Phones & Tablets": [
    "Brand", "Model", "Storage", "RAM", "Colour",
    "Battery Health", "Network", "Warranty"
  ],
  "💻 Electronics": [
    "Brand", "Model", "Screen Size", "RAM", "Storage",
    "Processor", "Warranty", "Colour"
  ],
  "👗 Fashion": [
    "Brand", "Size", "Colour", "Material", "Fit",
    "Gender", "Condition"
  ],
  "🪑 Home & Furniture": [
    "Material", "Colour", "Dimensions", "Brand",
    "Weight", "Style", "Assembly"
  ],
  "🚗 Vehicles": [
    "Make", "Model", "Year", "Mileage", "Transmission",
    "Fuel", "Body Type", "Colour", "Engine Size"
  ],
  "🏠 Property": [
    "Type", "Bedrooms", "Bathrooms", "Size (sqm)",
    "Furnished", "Year Built", "Tenure"
  ],
  "🛠️ Services": [
    "Service Type", "Experience", "Availability",
    "Location", "Languages", "Certifications"
  ],
  "🧸 Kids & Toys": [
    "Age Range", "Brand", "Material", "Colour",
    "Safety Rating", "Battery Required"
  ],
  "📚 Books & Education": [
    "Author", "Publisher", "Year", "Edition",
    "Language", "Pages", "Condition"
  ],
  "💄 Health & Beauty": [
    "Brand", "Volume", "Type", "Shade",
    "Expiry Date", "Skin Type", "Ingredients"
  ],
  "🍔 Food & Beverages": [
    "Brand", "Weight", "Type", "Expiry Date",
    "Packaging", "Origin", "Organic"
  ],
  "🐾 Pets & Animals": [
    "Breed", "Age", "Gender", "Vaccinated",
    "Colour", "Weight", "Trained"
  ]
};

// Universal fallbacks — always shown at the end of every list
const SELL_UNIVERSAL_LABELS = [
  "Colour", "Brand", "Condition", "Notes", "Other"
];

// Returns the suggestion list for a given category.
// Always appends the universal fallbacks.
function getLabelSuggestionsForCategory(category) {
  const base = SELL_LABEL_SUGGESTIONS[category] || [];
  // Merge and dedupe (case-insensitive)
  const seen = {};
  const merged = [];
  base.concat(SELL_UNIVERSAL_LABELS).forEach(function (item) {
    const key = item.toLowerCase();
    if (!seen[key]) {
      seen[key] = true;
      merged.push(item);
    }
  });
  return merged;
}
/* ============================================
   SESSION B — LABEL SUGGESTION DROPDOWN
   ============================================ */

// Wires up a suggestion panel for one label input.
// labelInput  — the input the user types into
// wrapperEl   — the .sell-detail-label-wrap (positioned relative)
// valueInput  — the Value input to focus after picking a suggestion
function attachLabelSuggestion(labelInput, wrapperEl, valueInput) {
  // Create the suggestion panel (hidden by default)
  const panel = document.createElement("div");
  panel.className = "sell-detail-suggestions";
  panel.style.display = "none";
  wrapperEl.appendChild(panel);

  let highlightedIndex = -1;

  // Build the filtered list of suggestion elements
  function renderSuggestions(filter) {
    panel.innerHTML = "";
    highlightedIndex = -1;

    const categoryEl = document.getElementById("itemCategory");
    const category = categoryEl ? categoryEl.value : "";
    const all = getLabelSuggestionsForCategory(category);

    const query = (filter || "").toLowerCase().trim();
    const filtered = query
      ? all.filter(function (s) { return s.toLowerCase().includes(query); })
      : all;

    if (filtered.length === 0) {
      panel.style.display = "none";
      return;
    }

    filtered.forEach(function (text, idx) {
      const item = document.createElement("div");
      item.className = "sell-detail-suggestion-item";
      item.textContent = text;
      item.setAttribute("data-index", String(idx));

      // Use mousedown to beat the input's blur event
      item.addEventListener("mousedown", function (e) {
        e.preventDefault(); // prevents blur firing before this runs
        labelInput.value = text;
        panel.style.display = "none";
        if (valueInput) valueInput.focus();
      });

      panel.appendChild(item);
    });

    panel.style.display = "block";
  }

  // Show when focused — filters based on what's already in the field
  labelInput.addEventListener("focus", function () {
    renderSuggestions(labelInput.value);
  });

  // Filter live as the user types
  labelInput.addEventListener("input", function () {
    renderSuggestions(labelInput.value);
  });

  // Hide on blur — but use a tiny delay so mousedown can still fire
  labelInput.addEventListener("blur", function () {
    setTimeout(function () {
      panel.style.display = "none";
    }, 120);
  });

  // Keyboard support: ArrowUp / ArrowDown / Enter / Escape
  labelInput.addEventListener("keydown", function (e) {
    const items = panel.querySelectorAll(".sell-detail-suggestion-item");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      updateHighlight(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateHighlight(items);
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && items[highlightedIndex]) {
        e.preventDefault();
        labelInput.value = items[highlightedIndex].textContent;
        panel.style.display = "none";
        if (valueInput) valueInput.focus();
      }
    } else if (e.key === "Escape") {
      panel.style.display = "none";
    }
  });

  function updateHighlight(items) {
    items.forEach(function (el, i) {
      el.classList.toggle("highlighted", i === highlightedIndex);
    });
  }
}
/* ============================================
   SESSION D — DETAIL THUMBNAIL STRIP
   ============================================ */

// Renders the thumbnail strip below the hero photo.
// Only shows for listings with 2+ photos.
function renderDetailThumbs(photoList) {
  const strip = document.getElementById("detailThumbs");
  if (!strip) return;

  strip.innerHTML = "";

  if (!photoList || photoList.length < 2) {
    strip.style.display = "none";
    return;
  }

  strip.style.display = "flex";

  photoList.forEach(function (src, i) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "detail-thumb" + (i === currentPhotoIndex ? " active" : "");
    btn.innerHTML = '<img src="' + src + '" alt="">';

    btn.addEventListener("click", function () {
      currentPhotoIndex = i;
      updateCarousel(photoList);
      updateThumbActive();
    });

    strip.appendChild(btn);
  });
}

// Updates which thumbnail has the green border.
function updateThumbActive() {
  const strip = document.getElementById("detailThumbs");
  if (!strip) return;
  const thumbs = strip.querySelectorAll(".detail-thumb");
  thumbs.forEach(function (el, i) {
    el.classList.toggle("active", i === currentPhotoIndex);
  });
}
/* ============================================
   SESSION D — RENDER CUSTOM DETAILS ROWS
   ============================================ */

// Renders the custom label/value rows saved from Session B
// into the DETAILS section of the detail page.
function renderCustomDetails(details) {
  const container = document.getElementById("detailCustomRows");
  if (!container) return;

  container.innerHTML = "";

  if (!details || !Array.isArray(details) || details.length === 0) {
    return;
  }

  details.forEach(function (row) {
    if (!row || !row.label || !row.value) return;

    const kv = document.createElement("div");
    kv.className = "detail-kv";

    const labelEl = document.createElement("span");
    labelEl.className = "detail-kv-label";
    labelEl.textContent = row.label;

    const valueEl = document.createElement("span");
    valueEl.className = "detail-kv-value";
    valueEl.textContent = row.value;

    kv.appendChild(labelEl);
    kv.appendChild(valueEl);
    container.appendChild(kv);
  });
}
/* ============================================
   SESSION D — META ROW HELPERS
   ============================================ */

// Builds a single "icon + text" chunk for the meta row.
// Each piece wraps its emoji in a fixed-width slot so
// every icon occupies the same horizontal space.
function buildMetaPiece(icon, text) {
  const wrap = document.createElement("span");
  wrap.className = "detail-meta-piece";

  const iconEl = document.createElement("span");
  iconEl.className = "detail-meta-icon";
  iconEl.textContent = icon;

  const textEl = document.createElement("span");
  textEl.className = "detail-meta-text";
  textEl.textContent = text;

  wrap.appendChild(iconEl);
  wrap.appendChild(textEl);
  return wrap;
}
/* ============================================
   SESSION D — SHOW PHONE NUMBER
   ============================================ */

let _currentSellerPhone = null;

// Resets the phone button when opening a new listing
function resetSellerPhoneButton(sellerId) {
  _currentSellerPhone = null;

  const btn = document.getElementById("detailPhoneBtn");
  if (!btn) return;

  // Hide the button entirely if we don't know the seller
  if (!sellerId) {
    btn.style.display = "none";
    return;
  }

  // Hide the button on my own listing
  if (sellerId === currentUserId) {
    btn.style.display = "none";
    return;
  }

  // Otherwise, show it in its default state
  btn.style.display = "";
  btn.classList.remove("revealed");
  btn.innerHTML = "📞 Show phone number";
}

// Called when the buyer taps "Show phone number"
async function revealSellerPhone() {
  const btn = document.getElementById("detailPhoneBtn");
  if (!btn) return;

  // Already revealed? Tapping again copies it to clipboard instead
  if (_currentSellerPhone) {
    try {
      await navigator.clipboard.writeText(_currentSellerPhone);
      marketaToast("Phone copied 📋");
    } catch (err) {
      marketaToast(_currentSellerPhone);
    }
    return;
  }

  const item = allListingsCache[currentItemIndex];
  if (!item || !item.sellerId) return;

  // Require login
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) {
    openAuthFromHeader();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = "Loading…";

  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", item.sellerId));

    let phone = "";
    if (snap.exists()) {
      const data = snap.data();
      phone = data.phone || data.phoneNumber || "";
    }

    if (!phone) {
      btn.disabled = false;
      btn.innerHTML = "📞 No phone on file";
      setTimeout(function () {
        btn.innerHTML = "📞 Show phone number";
      }, 2000);
      return;
    }

    _currentSellerPhone = phone;
    btn.disabled = false;
    btn.classList.add("revealed");
    btn.innerHTML = "📞 " + phone + "  ·  tap to copy";
  } catch (err) {
    console.warn("Failed to reveal phone:", err);
    btn.disabled = false;
    btn.innerHTML = "📞 Show phone number";
    marketaAlert("❌ Error", "Couldn't load phone number.");
  }
}

// ============================================
// BLOCK — detail-page button + flow
// ============================================

// Reveals or hides the "Block this seller" button on the
// detail page, depending on context.
function updateBlockButton(sellerId) {
  const btn = document.getElementById("detailBlockBtn");
  if (!btn) return;

  // Never show on my own listing
  if (!sellerId || sellerId === currentUserId) {
    btn.style.display = "none";
    return;
  }

  // Show normally
  btn.style.display = "";

  // If already blocked, show "Unblock this seller" style
  if (isUserBlocked(sellerId)) {
    btn.textContent = "🔓 Unblock Seller";
  } else {
    btn.textContent = "🚫 Block Seller";
  }
}

// Called when the user taps the block/unblock button.
async function blockCurrentSeller() {
  const item = allListingsCache[currentItemIndex];
  if (!item || !item.sellerId) return;
  if (item.sellerId === currentUserId) return;  // safety

  // Require login
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) {
    openAuthFromHeader();
    return;
  }
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  // Ensure the block cache is loaded
  if (!_blockedUsersLoaded) {
    await loadBlockedUsersFromFirestore();
  }

  const sellerId = item.sellerId;

  // Is this an unblock?
  if (isUserBlocked(sellerId)) {
    marketaConfirm(
      "🔓 Unblock this seller?",
      "You'll see their listings again, and you'll both be able to message each other.",
      async function () {
        const ok = await unblockUser(sellerId);
        if (ok) {
          marketaToast("Unblocked ✅");
          updateBlockButton(sellerId);
        } else {
          marketaAlert("❌ Error", "Couldn't unblock. Please try again.");
        }
      },
      null
    );
    return;
  }

  // Otherwise, this is a block
  const sellerName = document.getElementById("detailSellerName").textContent
    || "this seller";

  marketaConfirm(
    "🚫 Block this seller?",
    "You'll stop seeing their listings, and neither of you will be able to send new messages. Any existing chat between you stays readable on both sides as evidence.",
    async function () {
      const ok = await blockUser(sellerId);
if (ok) {
  marketaToast("Blocked " + sellerName);
  // Close the detail modal — we're about to hide their listings
  closeDetail();
  // Belt-and-braces: force a refresh again after the modal closes,
  // in case the block happened while the detail was still on screen.
  setTimeout(function () {
    refreshAllViewsAfterBlockChange();
  }, 50);
} else {
  marketaAlert("❌ Error", "Couldn't block. Please try again.");
}
    },
    null
  );
}

// ============================================
// REPORTS — convenience wrappers
// ============================================

// Called from the detail page's "Report this listing" button.
function reportCurrentListing() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;
  openReportModal("listing", item.id, formatTitle(item.name));
}

// Called from the profile page when viewing ANOTHER user's profile.
// Note: since Marketa currently only shows your own profile,
// this stays hidden until we add "view other user profiles".
function reportCurrentProfileUser() {
  // Uses a globally set variable (we'll populate it when we
  // add the ability to view other users' profiles)
  const targetUid = window._currentProfileUid;
  const targetName = window._currentProfileName || "this user";

  if (!targetUid) {
    marketaToast("Nothing to report here");
    return;
  }

  openReportModal("user", targetUid, targetName);
}

/* ============================================
   SESSION D-extra — ACCOUNT PHONE FIELD
   ============================================ */

// Loads the current phone number from Firestore into the input.
async function loadAccountPhone(uid) {
  const phoneInput = document.getElementById("accountPhoneInput");
  if (!phoneInput || !uid) return;

  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data();
      phoneInput.value = data.phone || "";
    }
  } catch (err) {
    console.warn("Failed to load phone:", err);
  }
}

// Loads the current bio + website from Firestore into the inputs.
async function loadAccountBioAndWebsite(uid) {
  const bioInput = document.getElementById("accountBioInput");
  const websiteInput = document.getElementById("accountWebsiteInput");
  if (!bioInput || !websiteInput || !uid) return;

  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data();
      bioInput.value = data.bio || "";
      websiteInput.value = data.website || "";
    }
  } catch (err) {
    console.warn("Failed to load bio/website:", err);
  }
}

// Loads the current location from Firestore into the two fields.
async function loadAccountLocation(uid) {
  const areaInput = document.getElementById("accountLocationArea");
  const regionInput = document.getElementById("accountLocationRegion");
  if (!areaInput || !regionInput || !uid) return;

  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data();
      areaInput.value = data.locationArea || "";
      regionInput.value = data.locationRegion || "";
    }
  } catch (err) {
    console.warn("Failed to load location:", err);
  }
}

// Reads the two fields + returns them as an object.
// Returns { area, region } — either may be empty string.
function readAccountLocation() {
  const areaInput = document.getElementById("accountLocationArea");
  const regionInput = document.getElementById("accountLocationRegion");
  return {
    area: areaInput ? (areaInput.value || "").trim() : "",
    region: regionInput ? (regionInput.value || "").trim() : ""
  };
}

/* ============================================
   SESSION F — DETAIL QUANTITY SELECTOR
   ============================================ */

// Holds the currently-viewed listing's max quantity
let _detailMaxQty = 1;

// Called from showDetail() to set up the quantity selector
function setupDetailQty(item) {
  const row = document.getElementById("detailQtyRow");
  const valueEl = document.getElementById("detailQtyValue");
  const minusBtn = document.getElementById("detailQtyMinus");
  const plusBtn = document.getElementById("detailQtyPlus");
  const stockEl = document.getElementById("detailQtyStock");
  if (!row || !valueEl || !minusBtn || !plusBtn || !stockEl) return;

  // How many does the seller have?
  const qty = (item.quantity !== undefined) ? Number(item.quantity) : 1;
  _detailMaxQty = Math.max(1, qty);

  // Reset the selector
  valueEl.textContent = "1";

  // Show/hide the whole control based on context
  const isMine = item.sellerId === currentUserId ||
                 item.sellerId === (currentAuthUser && currentAuthUser.uid);
  const isSold = !!item.sold;
  const noStock = _detailMaxQty <= 0;

  if (isMine || isSold || noStock) {
    row.style.display = "none";
    return;
  }

  row.style.display = "flex";

  updateQtyButtons();

  if (_detailMaxQty === 1) {
    stockEl.textContent = "";
  } else {
    stockEl.textContent = _detailMaxQty + " available";
  }
}

// Tapping + or −
function changeDetailQty(delta) {
  const valueEl = document.getElementById("detailQtyValue");
  if (!valueEl) return;

  let v = Number(valueEl.textContent) || 1;
  v = v + delta;

  if (v < 1) v = 1;
  if (v > _detailMaxQty) v = _detailMaxQty;

  valueEl.textContent = String(v);
  updateQtyButtons();
}

// (placeholder — no longer needed since there's no input)
function onDetailQtyInput() { /* not used */ }

// Enables/disables +/− based on current value
function updateQtyButtons() {
  const valueEl = document.getElementById("detailQtyValue");
  const minusBtn = document.getElementById("detailQtyMinus");
  const plusBtn = document.getElementById("detailQtyPlus");
  if (!valueEl || !minusBtn || !plusBtn) return;

  const v = Number(valueEl.textContent) || 1;
  minusBtn.disabled = (v <= 1);
  plusBtn.disabled = (v >= _detailMaxQty);
}

/* ============================================
   SESSION F — REVIEW CARD: DETAILS ROWS
   ============================================ */

// Builds the "Details" list HTML for the review card.
// Reads from the current rows in the Sell form (Session B).
function buildReviewDetailsHtml() {
  const rows = getDetailRows();
  if (!rows || rows.length === 0) return "";

  let html = '<div class="sell-review-details">';
  rows.forEach(function (row) {
    html +=
      '<div class="sell-review-detail-row">' +
        '<span class="sell-review-detail-label">' + escapeHtml(row.label) + '</span>' +
        '<span class="sell-review-detail-value">' + escapeHtml(row.value) + '</span>' +
      '</div>';
  });
  html += '</div>';
  return html;
}
/* ============================================
   DRAWER — HIDE PERSONAL ITEMS WHEN LOGGED OUT
   ============================================ */

// Called when the drawer opens. Hides the personal rows
// (profile, listings, shop, orders, messages, saved items,
// log out) if no one is signed in.
function updateDrawerForAuthState() {
  const fb = window.marketaFirebase;
  const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  
  // If Firebase is still loading, assume they are logged in to prevent the 
  // buttons from flashing and disappearing. Firebase will correct this
  // milliseconds later if they are actually a guest.
  const isStillLoading = !_authReady;
  const loggedIn = !!user || isStillLoading;
  
  // Personal grid buttons
  const gridPages = ["profile", "listings", "shop", "orders", "messages", "wishlist"];
  gridPages.forEach(function (page) {
    const btn = document.querySelector('.drawer-grid-btn[data-page="' + page + '"]');
    if (btn) btn.style.display = loggedIn ? "" : "none";
  });

  // Log out button
  const logoutBtn = document.querySelector(".drawer-logout");
  if (logoutBtn) logoutBtn.style.display = loggedIn ? "" : "none";
  // Hide the Settings row too
const settingsRow = document.querySelector('.drawer-row[onclick*="openSettings"]');
if (settingsRow) settingsRow.style.display = loggedIn ? "" : "none";

  // Also hide the "Sell" button? No — Sell should stay for
  // logged-out users (it triggers login), so leave it as-is.
}
/* ============================================
   SESSION F — READ SELECTED QUANTITY
   ============================================ */

// Reads the quantity currently selected on the detail page.
// Returns 1 if the selector isn't visible or missing.
function readDetailQty() {
  const valueEl = document.getElementById("detailQtyValue");
  const row = document.getElementById("detailQtyRow");
  if (!valueEl || !row) return 1;
  if (row.style.display === "none") return 1;

  const n = Number(valueEl.textContent);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

// ============================================
// RECENTLY VIEWED — track + render
// ============================================

const RECENTLY_VIEWED_KEY = "marketaRecentlyViewed";
const RECENTLY_VIEWED_MAX = 6;           // store up to 6
const RECENTLY_VIEWED_SHOW = 6;          // show up to 6

// Reads the recently-viewed list from localStorage.
// Returns an array of { id, viewedAt } (most recent first).
function loadRecentlyViewed() {
  try {
    const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    return [];
  }
}

// Saves the list back to localStorage.
function saveRecentlyViewed(list) {
  try {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore — quota exceeded, etc.
  }
}

// Records a listing as "viewed". Deduplicates + caps the list.
function recordListingView(listingId) {
  if (!listingId) return;

  let list = loadRecentlyViewed();

  // Remove any existing entry for this listing
  list = list.filter(function (item) { return item.id !== listingId; });

  // Add this listing to the top
  list.unshift({ id: listingId, viewedAt: Date.now() });

  // Cap the length
  if (list.length > RECENTLY_VIEWED_MAX) {
    list = list.slice(0, RECENTLY_VIEWED_MAX);
  }

  saveRecentlyViewed(list);
}

/* ============================================
   VIEWS COUNTER
   ============================================ */

// Tracks which listings we've already bumped this session,
// so tapping back-and-forth doesn't inflate the count.
// Tracks listings we've already bumped — persists across
// app restarts. Entries expire after 24 hours so a returning
// visitor tomorrow counts as a fresh view.
let _viewedThisSession = (function loadViewedCache() {
  try {
    const raw = localStorage.getItem("marketaViewedListings");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Drop entries older than 24 hours
    const oneDayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const pruned = {};
    Object.keys(parsed).forEach(function (id) {
      if (now - parsed[id] < oneDayMs) pruned[id] = parsed[id];
    });
    return pruned;
  } catch (e) {
    return {};
  }
})();

// Saves the viewed cache to localStorage.
function persistViewedCache() {
  try {
    localStorage.setItem("marketaViewedListings", JSON.stringify(_viewedThisSession));
  } catch (e) {
    // ignore
  }
}

// Increments a listing's view count by 1 in Firestore.
// Safe to call repeatedly — only bumps once per session per listing.
async function incrementListingViews(listingId) {
  if (!listingId) return;
  if (_viewedThisSession[listingId]) return;  // already bumped recently
_viewedThisSession[listingId] = Date.now();
persistViewedCache();

  const listing = allListingsCache.find(function (l) { return l.id === listingId; });
  if (!listing) return;

  const newCount = (Number(listing.views) || 0) + 1;

  try {
    const { db, doc, setDoc } = await getFsModules();
    const updated = Object.assign({}, listing, { views: newCount });
    await setDoc(doc(db, "listings", String(listingId)), updated);

    // Update local cache so the UI can reflect it immediately
    listing.views = newCount;

    // Live-refresh the views display if it's on the page
    const viewsEl = document.getElementById("detailViewsCount");
    if (viewsEl) if (viewsEl) viewsEl.textContent = newCount + " view" + (newCount === 1 ? "" : "s");
  } catch (err) {
    console.warn("incrementListingViews failed:", err);
  }
}
async function submitCheckout() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;

  // ---- Validate address ----
  const addressEl = document.getElementById("checkoutAddress");
  const address = addressEl ? addressEl.value.trim() : "";
  if (!address) {
    marketaAlert("Missing address", "Please enter a delivery address or meet-up area. 🙏");
    return;
  }

  // ---- Read delivery mode ----
  const modeEl = document.querySelector('.checkout-mode-option.selected');
  const deliveryMode = modeEl ? modeEl.getAttribute("data-mode") : "meetup";

  // ---- Read optional note ----
  const noteEl = document.getElementById("checkoutNote");
  const note = noteEl ? noteEl.value.trim() : "";

  // ---- Require login ----
  const fb = window.marketaFirebase;
  const liveUser = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
  if (!liveUser) {
    openAuthFromHeader();
    return;
  }
  currentAuthUser = liveUser;
  currentUserId = liveUser.uid;

  // ---- Auto-fill phone from profile ----
  let cleanPhone = "";
  try {
    const { db, doc, getDoc } = await getFsModules();
    const snap = await getDoc(doc(db, "users", liveUser.uid));
    if (snap.exists()) {
      const data = snap.data();
      cleanPhone = data.phone || "";
    }
  } catch (err) {
    console.warn("Failed to load phone:", err);
  }

  if (!cleanPhone) {
    marketaAlert(
      "📞 Phone needed",
      "We need a phone number to arrange delivery. Please add one in Settings → Account, then try again."
    );
    return;
  }

  // ---- Read quantity + build order ----
  const qty = readDetailQty();
  const unitPrice = Number(item.price) || 0;
  const total = unitPrice * qty;

  const refNumber = "MKT-" + String(Date.now()).slice(-6);
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const order = {
    ref: refNumber,
    itemId: item.id || null,
    itemName: item.name,
    itemPrice: unitPrice,
    quantity: qty,
    total: total,
    buyerPhone: cleanPhone,
    buyerLocation: address,
    buyerNote: note,
    deliveryMode: deliveryMode,
    buyerId: currentUserId,
    sellerId: item.sellerId || null,
    status: "Paid — funds held in escrow",
    date: new Date().toLocaleDateString(),
    createdAt: now,
    shipDeadline: now + FIVE_DAYS_MS,
    confirmDeadline: null,
    extensions: { buyer: 0, seller: 0 }
  };

  // ---- Save ----
  const payBtn = document.getElementById("checkoutPayBtn");
  if (payBtn) {
    payBtn.disabled = true;
    payBtn.textContent = "Processing…";
  }

  try {
    await saveOrderToFirestore(order);
await loadOrdersFromFirestore();

// ---- Show success ----
showCheckoutSuccess(refNumber, item, qty, total);

  } catch (err) {
    marketaAlert("❌ Error", "Failed to save order: " + err.message);
    if (payBtn) {
      payBtn.disabled = false;
      payBtn.innerHTML = '<span class="checkout-pay-shield">🛡️</span> Pay into escrow';
    }
  }
}

// Replaces the checkout page content with a success screen.
function showCheckoutSuccess(refNumber, item, qty, total) {
  const page = document.getElementById("checkoutPage");
  if (!page) return;

  const shell = page.querySelector(".page-shell");
  if (!shell) return;

  shell.innerHTML =
    '<div style="text-align:center;padding:40px 0 20px;">' +
      '<div style="font-size:64px;line-height:1;margin-bottom:12px;">🎉</div>' +
      '<h1 style="font-size:24px;font-weight:800;color:var(--text-dark);margin-bottom:8px;">Payment held in escrow!</h1>' +
      '<p style="font-size:14px;color:var(--text-gray);margin-bottom:20px;">The seller has been notified and will ship soon. You\'ll get a call to arrange delivery.</p>' +
    '</div>' +
    '<div class="page-card">' +
      '<div class="checkout-summary-row"><span>Order ref</span><strong>' + escapeHtml(refNumber) + '</strong></div>' +
      '<div class="checkout-summary-row"><span>Item</span><strong>' + escapeHtml(formatTitle(item.name)) + (qty > 1 ? ' × ' + qty : '') + '</strong></div>' +
      '<div class="checkout-summary-total"><span>Held in escrow</span><span class="amount">GH₵ ' + total.toLocaleString() + '</span></div>' +
    '</div>' +
    '<div class="checkout-info-banner" style="margin-top:16px;">' +
      '🛡️ <strong>Your money is safe.</strong> Once you confirm delivery, funds will be released to the seller. If something goes wrong, you can request a return or raise a dispute.' +
    '</div>' +
    '<button class="checkout-pay-btn" onclick="closeCheckoutAndReset()" style="margin-top:16px;">Done</button>' +
    '<p class="checkout-footnote">Track this order in <strong>Mine → My orders</strong>.</p>';
}

// Closes the checkout page AND resets it to the original form,
// so it can be reopened for a new purchase.
function closeCheckoutAndReset() {
  const page = document.getElementById("checkoutPage");
  if (!page) return;

  // Close it
  closeCheckout();

  // Reload the page's original content
  // Easiest way: reload the whole app
  setTimeout(function() {
    window.location.reload();
  }, 200);
}
// ============================================
// BOOST LISTING (Time-Based)
// ============================================
function openBoostModal() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;
  
  const isCurrentlyPromoted = item.isPromoted && (!item.promotedExpiresAt || item.promotedExpiresAt > Date.now());
  if (isCurrentlyPromoted) {
    const expDate = item.promotedExpiresAt ? new Date(item.promotedExpiresAt).toLocaleDateString() : "forever";
    marketaAlert("Already Boosted", "This listing is already promoted until " + expDate + ".");
    return;
  }
  
  document.getElementById("boostError").style.display = "none";
  document.getElementById("boostModal").style.display = "flex";
  
  // Set up the radio button click listeners to highlight the selected box
  const options = document.querySelectorAll("#boostModal .checkout-mode-option");
  options.forEach(function (opt) {
    if (opt.dataset.handlerAttached === "yes") return;
    opt.dataset.handlerAttached = "yes";
    opt.addEventListener("click", function (e) {
      e.preventDefault();
      options.forEach(function (o) { o.classList.remove("selected"); });
      opt.classList.add("selected");
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  pushLayer("boostModal", closeBoostModal);
saveLastLocation("boostModal", {}); // Saves layer for back button
}

function closeBoostModal() {
  document.getElementById("boostModal").style.display = "none";
  popLayer("boostModal");
  
  // If the Detail Modal is open underneath, we are NOT going home.
  // We stay on the Detail page.
  if (_layerStack.some(function(l) { return l.id === "detailModal"; })) {
      // Do nothing, detail page is already open behind the modal
  } else if (!hasAnotherPageOpen("boostModal")) {
      document.body.classList.remove("page-open");
  }
}

async function submitBoost() {
  const item = allListingsCache[currentItemIndex];
  if (!item) return;

  // Get the selected duration (in days)
  const selectedRadio = document.querySelector('input[name="boostPlan"]:checked');
  if (!selectedRadio) return;
  const days = Number(selectedRadio.value);

  const btn = document.querySelector("#boostModal .buy-btn");
  const originalText = btn.textContent;
  btn.textContent = "Processing payment…";
  btn.disabled = true;

  // Simulate a 1.5 second payment processing delay
  setTimeout(async function() {
    try {
      const { db, doc, setDoc } = await getFsModules();
      
      // Calculate the expiry date
      const now = Date.now();
      const expiresAt = now + (days * 24 * 60 * 60 * 1000);

      const updated = Object.assign({}, item, { 
        isPromoted: true,
        promotedAt: now,
        promotedExpiresAt: expiresAt
      });
      
      await setDoc(doc(db, "listings", String(item.id)), updated);
      
      // Update local cache
      item.isPromoted = true;
      item.promotedAt = now;
      item.promotedExpiresAt = expiresAt;

      closeBoostModal();
      marketaToast("Listing Boosted! 🚀");
      
      // Refresh the UI
      renderListings(allListingsCache);
      showDetail(currentItemIndex); // Reload detail to hide the boost button

    } catch (err) {
      btn.textContent = originalText;
      btn.disabled = false;
      document.getElementById("boostError").textContent = "Payment failed: " + err.message;
      document.getElementById("boostError").style.display = "block";
    }
  }, 1500);
}
// ============================================
// MODERATION — ANALYTICS TAB (Owner Only)
// ============================================
function renderModAnalytics(body) {
  // Double check: If they aren't the owner, don't render it
  if (!isCurrentUserOwner()) {
    body.innerHTML = '<div class="empty-state"><div class="empty-state-title">Owner Only</div><div class="empty-state-text">You do not have permission to view platform revenue.</div></div>';
    return;
  }

  let totalVolume = 0;
  let totalOrders = 0;
  let totalBoostRevenue = 0;
  let monthlyRevenue = 0;
  let monthlyVolume = 0;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // 1. Calculate Marketplace Volume
  allOrdersCache.forEach(function (o) {
    if (o.status === "Funds released to seller") {
      totalOrders++;
      const amt = Number(o.total) || 0;
      totalVolume += amt;

      const orderDate = new Date(o.releasedAt || o.createdAt || 0);
      if (orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear) {
        monthlyVolume += amt;
      }
    }
  });

  // 2. Calculate Boost Revenue
  allListingsCache.forEach(function (l) {
    if (l.promotedAt) {
      const durationDays = Math.round((l.promotedExpiresAt - l.promotedAt) / (1000 * 60 * 60 * 24));
      let price = 0;
      if (durationDays >= 360) price = 150;       // 1 Year
      else if (durationDays >= 175) price = 90;   // 6 Months
      else if (durationDays >= 85) price = 50;    // 3 Months
      else price = 20;                            // 1 Month

      totalBoostRevenue += price;

      const promoDate = new Date(l.promotedAt);
      if (promoDate.getMonth() === currentMonth && promoDate.getFullYear() === currentYear) {
        monthlyRevenue += price;
      }
    }
  });

  const html =
    '<div class="mod-cards-list">' +
      
      // Revenue Card
      '<div class="mod-card" style="background: var(--green-light); border-color: var(--green-pale);">' +
        '<div class="mod-card-header">' +
          '<span class="mod-card-title" style="color: var(--green-dark);">💰 Platform Revenue (Boosts)</span>' +
        '</div>' +
        '<div style="font-size: 28px; font-weight: 800; color: var(--green-dark); margin: 10px 0;">GH₵ ' + totalBoostRevenue.toLocaleString() + '</div>' +
        '<div class="mod-card-row">This month: <strong>GH₵ ' + monthlyRevenue.toLocaleString() + '</strong></div>' +
      '</div>' +

      // Volume Card
      '<div class="mod-card">' +
        '<div class="mod-card-header">' +
          '<span class="mod-card-title">🤝 Marketplace Volume (GMV)</span>' +
        '</div>' +
        '<div style="font-size: 28px; font-weight: 800; color: var(--text-dark); margin: 10px 0;">GH₵ ' + totalVolume.toLocaleString() + '</div>' +
        '<div class="mod-card-row">This month: <strong>GH₵ ' + monthlyVolume.toLocaleString() + '</strong></div>' +
      '</div>' +

      // Orders Card
      '<div class="mod-card">' +
        '<div class="mod-card-header">' +
          '<span class="mod-card-title">📦 Successfully Completed Orders</span>' +
        '</div>' +
        '<div style="font-size: 28px; font-weight: 800; color: var(--text-dark); margin: 10px 0;">' + totalOrders + '</div>' +
        '<div class="mod-card-row">Total deals closed on Marketa</div>' +
      '</div>' +

    '</div>';

  body.innerHTML = html;
}
// ============================================
// BROWSE HISTORY PAGE
// ============================================
function openBrowseHistory() {
  const page = document.getElementById("browseHistoryPage");
  if (!page) return;

  page.style.display = "flex";
  document.body.classList.add("page-open");

  renderBrowseHistory();
  pushLayer("browseHistoryPage", closeBrowseHistory);
}

function closeBrowseHistory() {
  const page = document.getElementById("browseHistoryPage");
  if (page) page.style.display = "none";

  popLayer("browseHistoryPage");

  if (!hasAnotherPageOpen("browseHistoryPage")) {
    document.body.classList.remove("page-open");
  }
}

function renderBrowseHistory() {
  const grid = document.getElementById("browseHistoryGrid");
  const empty = document.getElementById("browseHistoryEmpty");
  const countEl = document.getElementById("browseHistoryCount");
  if (!grid || !empty) return;

  grid.innerHTML = "";

  const list = loadRecentlyViewed();
  const myUid = (currentAuthUser && currentAuthUser.uid) || currentUserId || null;

  // Filter valid listings
  const items = list.map(function (entry) {
    return allListingsCache.find(function (l) { return l.id === entry.id; });
  }).filter(function (item) {
    if (!item) return false;
    if (item.hidden) return false;
    if (myUid && item.sellerId === myUid) return false; // Hide own listings
    return true;
  });

  if (countEl) countEl.textContent = items.length + " item" + (items.length === 1 ? "" : "s");

  if (items.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  items.forEach(function (item) {
    const card = document.createElement("div");
    card.className = "history-item";
    
    const photos = (item.photos && item.photos.length > 0) ? item.photos : (item.photo ? [item.photo] : []);
    const thumb = photos[0] || null;
    
    card.innerHTML =
      '<div class="history-thumb">' +
        (thumb ? '<img src="' + thumb + '" alt="">' : '📦') +
      '</div>' +
      '<div class="history-info">' +
        '<div class="history-price">GH₵ ' + Number(item.price).toLocaleString() + '</div>' +
        '<div class="history-title">' + escapeHtml(formatTitle(item.name)) + '</div>' +
        '<div class="history-meta">' + locationIcon() + ' ' + escapeHtml(item.location || "—") + '</div>' +
      '</div>';
      
    card.onclick = function () {
      const realIndex = allListingsCache.findIndex(function (l) { return l.id === item.id; });
      if (realIndex >= 0) {
        closeBrowseHistory();
        setTimeout(function () { showDetail(realIndex); }, 200);
      }
    };
    
    grid.appendChild(card);
  });
}

function clearBrowseHistory() {
  marketaConfirm(
    "Clear history",
    "Are you sure you want to clear your entire browsing history?",
    function () {
      localStorage.removeItem(RECENTLY_VIEWED_KEY);
      renderBrowseHistory();
      marketaToast("History cleared");
    },
    null
  );
}
// ============================================
// WELCOME ONBOARDING
// ============================================
function showWelcomeModal() {
  const modal = document.getElementById("welcomeModal");
  if (!modal) return;

  // Only show if they haven't seen it yet
  const hasSeenWelcome = localStorage.getItem("marketaWelcomeSeen");
  if (hasSeenWelcome === "yes") return;

  modal.style.display = "flex";
  pushLayer("welcomeModal", closeWelcomeModal);
}

function closeWelcomeModal() {
  const modal = document.getElementById("welcomeModal");
  if (modal) modal.style.display = "none";
  
  // Save to localStorage so it never shows again
  localStorage.setItem("marketaWelcomeSeen", "yes");
  
  popLayer("welcomeModal");
}

// Trigger the modal when they log in
window.addEventListener("firebase-ready", function() {
  // Wait 1.5 seconds after auth finishes so it doesn't clash with the page load
  setTimeout(function() {
    const fb = window.marketaFirebase;
    const user = currentAuthUser || (fb && fb.auth && fb.auth.currentUser);
    
    // If they are logged in, show the welcome popup
    if (user) {
      showWelcomeModal();
    }
  }, 1500);
});