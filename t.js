import fetch from "node-fetch";

const token = "YOUR_TOKEN_HERE";

fetch("http://localhost:5000/wallet/history", {
  headers: { Authorization: "Bearer " + token }
})
  .then(res => res.text())
  .then(console.log)
  .catch(console.error);
