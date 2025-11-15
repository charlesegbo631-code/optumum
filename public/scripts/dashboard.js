document.addEventListener("DOMContentLoaded", () => {
  const themeBtn = document.getElementById("themeBtn");
  const addMoneyBtn = document.getElementById("addMoneyBtn");
  const balanceEl = document.getElementById("wallet-balance");
  const body = document.body;

  // --- THEME ---
  if (localStorage.getItem("theme") === "dark") {
    body.classList.add("dark");
    themeBtn.textContent = "☀️ Light Mode";
  }

  themeBtn.addEventListener("click", () => {
    body.classList.toggle("dark");
    const isDark = body.classList.contains("dark");
    themeBtn.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });

  // --- FETCH WALLET BALANCE ---
  async function fetchBalance() {
    const token = localStorage.getItem("ul_token");
    if (!token) {
      Swal.fire({
        icon: "warning",
        title: "Session Expired",
        text: "Please log in again.",
        confirmButtonText: "Go to Login"
      }).then(() => (window.location.href = "login.html"));
      return;
    }

    try {
      const res = await fetch("/wallet", {
        headers: { Authorization: "Bearer " + token }
      });

      if (!res.ok) {
        localStorage.removeItem("ul_token");
        Swal.fire({
          icon: "error",
          title: "Authentication Error",
          text: "Please log in again."
        }).then(() => (window.location.href = "login.html"));
        return;
      }

      const data = await res.json();
      if (data.balance !== undefined) {
        balanceEl.textContent = `₦${data.balance.toFixed(2)}`;
      }
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error Loading Wallet",
        text: err.message
      });
    }
  }

  // --- START PAYSTACK DEPOSIT ---
  async function startDeposit(amount) {
    const token = localStorage.getItem("ul_token");
    if (!token) {
      return Swal.fire({
        icon: "warning",
        title: "Not Logged In",
        text: "Please log in first."
      });
    }

    try {
      const res = await fetch("/wallet/paystack/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({ amount: Number(amount) })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment initialization failed");

      // Redirect to Paystack Checkout
      Swal.fire({
        icon: "info",
        title: "Redirecting to Payment",
        text: "Please complete your payment on Paystack...",
        showConfirmButton: false,
        timer: 2000
      });
      window.location.href = data.authorization_url;
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Deposit Error",
        text: err.message
      });
    }
  }

  // --- ADD MONEY BUTTON ---
  addMoneyBtn.addEventListener("click", async () => {
    const { value: amount } = await Swal.fire({
      title: "Add Money",
      input: "number",
      inputLabel: "Enter amount to deposit (₦)",
      inputPlaceholder: "e.g. 1000",
      showCancelButton: true,
      confirmButtonText: "Deposit",
      inputValidator: (value) => {
        if (!value || isNaN(value) || value <= 0) return "Please enter a valid amount";
      }
    });

    if (amount) {
      await startDeposit(amount);
    }
  });

  fetchBalance();

  // --- VIEW TRANSACTION HISTORY ---
  const historyBtn = document.getElementById("historyBtn");
  if (historyBtn) {
    historyBtn.addEventListener("click", async () => {
      const token = localStorage.getItem("ul_token");
      if (!token) {
        return Swal.fire({
          icon: "warning",
          title: "Not Logged In",
          text: "Please log in first."
        });
      }

      try {
        const res = await fetch("/wallet/history", {
          headers: { Authorization: "Bearer " + token }
        });

        if (!res.ok) throw new Error("Failed to load transaction history");

        const history = await res.json();

        if (!Array.isArray(history) || history.length === 0) {
          return Swal.fire({
            icon: "info",
            title: "No Transactions Yet",
            text: "You haven’t made any deposits or withdrawals."
          });
        }

        // Build a nice HTML table for SweetAlert2
        const tableHTML = `
          <div style="max-height:300px;overflow:auto;text-align:left">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#0a7c58;color:#fff;">
                  <th style="padding:8px;">Date</th>
                  <th style="padding:8px;">Type</th>
                  <th style="padding:8px;">Amount</th>
                  <th style="padding:8px;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${history.map(tx => `
                  <tr style="border-bottom:1px solid #ccc;">
                    <td style="padding:8px;">${new Date(tx.date).toLocaleString()}</td>
                    <td style="padding:8px;">${tx.type || 'N/A'}</td>
                    <td style="padding:8px;">₦${tx.amount.toFixed(2)}</td>
                    <td style="padding:8px;">${tx.status || 'completed'}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;

        Swal.fire({
          title: "Transaction History",
          html: tableHTML,
          width: 600,
          confirmButtonText: "Close"
        });
      } catch (err) {
        Swal.fire({
          icon: "error",
          title: "Error Fetching History",
          text: err.message
        });
      }
    });
  }

  // --- HANDLE CARD CLICK REDIRECTIONS ---
  const cardActions = {
    foreignNumbersCard: "foreign-numbers.html",
    boostOrdersCard: "boost-orders.html",
    referEarnCard: "refer-earn.html",
    supportCard: "support.html",
    historyCard: "history.html",
    profileCard: "profile.html",
    logoutCard: "logout.html",
    buyAirtimeCard: "buy-airtime.html",
    buyDataCard: "buy-data.html",
    buyLogCard: "buy-log.html",
    rentNumberCard: "rent-number.html",
    buyProxyCard: "buy-proxy.html", // Buy Proxy
    buyVpnCard: "buy-vpn.html",     // Buy VPN
    disposableEmailCard: "disposable-email.html" // Disposable Email
  };

  // Loop through each card and add event listener for click redirection
  for (const [cardId, url] of Object.entries(cardActions)) {
    const card = document.getElementById(cardId);
    if (card) {
      card.addEventListener("click", () => {
        window.location.href = url;
      });
    }
  }
});
