SHEET_ID = "1hqIfYwQGvUdQ85aTVrGsFuyQSuaoch_Spx7E_ebvxf0"
SHEET_NAME = "Sheet1"
var dropdownList;
var selectedDateColumn = "D";
var numberLocations = {
  paycheck: 2,
  withdrawals: [6, 8],
  variableExpenses: [5, 7, 9] 
}

async function getSheetCell(sheetId, sheetName, cell) {

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${sheetName}&range=${cell}`;

    const response = await fetch(url);
    const text = await response.text();

    // Google wraps JSON in weird text — clean it
    const json = JSON.parse(
        text.substring(47).slice(0, -2)
    );

    const value = json.table.rows[0].c[0].v;

    return value;
}

// async function loadSheet() {

//     const url =
//         `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}&range=A:Z`;

//     const response = await fetch(url);
//     const text = await response.text();

//     const json = JSON.parse(text.substring(47).slice(0, -2));

//     // Convert Google format → 2D array
//     sheetData = json.table.rows.map(row =>
//         row.c.map(cell => cell ? cell.v : "")
//     );

//     console.log("Sheet Loaded:", sheetData);
// }

async function loadSheet() {

    const url =
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;

    const response = await fetch(url);
    const text = await response.text();

    const parsed = Papa.parse(text, {
        skipEmptyLines: false
    });

    sheetData = parsed.data;

    console.log("Sheet Loaded (CSV safe):", sheetData);
}

function to_a(c1 = 'a', c2 = 'z') {
    a = 'abcdefghijklmnopqrstuvwxyz'.split('');
    return (a.slice(a.indexOf(c1), a.indexOf(c2) + 1)); 
}

function getCell(row, col) {
    return sheetData[row][col];
}

function getRow(rowIndex) {
    return sheetData[rowIndex].filter(Boolean);
}

function columnToIndex(col) {
    return col
        .toUpperCase()
        .split("")
        .reduce((r, c) => r * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

function getCellA1(a1) {
    const match = a1.match(/([A-Z]+)(\d+)/);
    const col = columnToIndex(match[1]);
    const row = parseInt(match[2]) - 1;

    return sheetData[row][col];
}

function excelDateToJSDate(serial) {
    const utc = (serial - 25569) * 86400 * 1000;
    return new Date(utc + (new Date().getTimezoneOffset() * 60000));
}

function formatDate(serial) {
    const date = excelDateToJSDate(serial);

    return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function getCleanColumn(colIndex) {
    return sheetData
        .map(row => row[colIndex])
}

function parseCurrency(value) {
    return Number(
        value.replace(/[$,]/g, "").trim()
    );
}

function createDateDropdown() {
  var dateRow = getRow(0);
  
  var i = 0;
  for (const dateNumber of dateRow) {
    console.log(i);
    var workingOption = document.createElement("option");
    workingOption.textContent = dateNumber;
    workingOption.value = to_a("d", "z")[i];
    dropdownList.appendChild(workingOption);
    i++;
  }
}



//because global variables cant be set outside the async "init()" function
function setupGlobalVariables() {
  dropdownList = document.getElementById("DateSelection");
}

function setValues() {
  document.getElementById("paycheckAmount").innerHTML = getCellA1(selectedDateColumn + numberLocations.paycheck);
  var totalWithdrawalAmount = 0;
  for (var i = 0; i < numberLocations.withdrawals.length; i++) {
    totalWithdrawalAmount = totalWithdrawalAmount + parseCurrency(getCellA1(selectedDateColumn + numberLocations.withdrawals[i]));
  }

  document.getElementById("withdrawalAmount").innerHTML = formatter.format(totalWithdrawalAmount);

  var totalVExpenses = 0;
  for (var k = 0; k < numberLocations.variableExpenses.length; k++) {
    totalVExpenses = totalVExpenses + parseCurrency(getCellA1(selectedDateColumn + numberLocations.variableExpenses[k]));
  }
  
  document.getElementById("variableExpenses").innerHTML = formatter.format(totalVExpenses);
}

function implementListeners() {
  dropdownList.addEventListener("change", function() {
      selectedDateColumn = dropdownList.value.toUpperCase();
      setValues();
  });
}

//money formatter
const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

async function init() {
  await loadSheet();

  setupGlobalVariables();
  setValues();
  createDateDropdown();
  implementListeners();

  console.log(getCleanColumn(columnToIndex("D")))
}

init();




