/****************************************************
             CONFIGURATION
*****************************************************/
const COLORS = {
  bg1: '#1D1F21',
  bg2: '#282A2E',
  error1: '#800000',
  error2: '#080000'
};

const FONT_NAME = "Menlo"
const regularFont = new Font(FONT_NAME, 11);
const smallFont = new Font(FONT_NAME, 9);
const regularColor = Color.white();

const BASE_URL = 'https://dev.lunchmoney.app';

const local = FileManager.local();
const iCloud = FileManager.iCloud();

const BASE_FILE = 'LunchMoneyWidget';
const API_FILE = "apiKey";
const CACHE_KEY = "lunchMoneyCache";
const CACHED_MS = 7200000; // 2 hours

const ICLOUD = "iCloud";
const LOCAL = "local";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const USE_PAY_CYCLE = args.widgetParameter != null
const PAY_CYCLE_ID = args.widgetParameter;

/****************************************************
 SETUP
 *****************************************************/

const Layout = initLayout();
const cache = new Cache(ICLOUD);
const LM_ACCESS_TOKEN = await getApiKey();
const widget = await getWidget();

Script.setWidget(widget);
Script.complete();

/****************************************************
             WIDGET
*****************************************************/

async function getWidget() {
  const lunchMoneyData = await getAllData();
  
  const widget = new ListWidget();
  widget.title = "Lunch Money";

  let gradient;
  if(lunchMoneyData.accountsInError > 0){
    gradient = getLinearGradient(COLORS.error1, COLORS.error2);
  }else{
    gradient = getLinearGradient(COLORS.bg1, COLORS.bg2);
  }
  widget.backgroundGradient = gradient;
  
  const mainStack = widget.addStack();
  mainStack.layoutVertically();
  mainStack.spacing = 2;
  
  const widgetFamily = config.widgetFamily;
  Layout[widgetFamily](mainStack, lunchMoneyData);

  return widget;
};

async function getAllData() {
  const cached = cache.get(CACHE_KEY, CACHED_MS);
  if (cached) {
    console.log("get data from cache");
    return JSON.parse(cached);
  }
  
  console.log("get data from api server");

  const responses = await Promise.all([
    lunchMoneyGetPendingTransactions(),
    lunchMoneyGetPlaidAccountsInfo(),
    lunchMoneyGetIncomeAndExpenseData(),
    lunchMoneyGetAssetsInfo(),
  ])

  if(!responses[0]){
    console.log("force get data from cache");
    return JSON.parse(cache.forceGet(CACHE_KEY));
  }
  
  const data = {
    pendingTransactions: responses[0],
    ...responses[1],
    ...responses[2],
    ...responses[3]
  };
  
  cache.set(CACHE_KEY, JSON.stringify(data));
  return data;
}

/****************************************************
             UI FUNCTIONS
*****************************************************/

function getLinearGradient(color1, color2) {  
  const gradient = new LinearGradient();       
  gradient.colors = [new Color(color1), new Color(color2)];
  gradient.locations = [0.0, 1.0];
  return gradient;
};

/****************************************************
            API
*****************************************************/

async function getApiKey() {
  const keyLocation = BASE_FILE + "/" + API_FILE;
  const exists = doesFileExist(keyLocation);
  if (exists) {
    return await readString(keyLocation, exists);
  }
  const alert = new Alert();
  alert.addSecureTextField("api_key", "");
  alert.addAction("Device");
  alert.addAction("iCloud");
  alert.title = "Lunch Money API Key";
  alert.message = "Please enter your lunch money API key, found at https://my.lunchmoney.app/developers. Where do you want to save this information?";

  const option = await alert.present();
  const apiKey = alert.textFieldValue(0);
  
  saveToFile(apiKey, API_FILE, option === 0 ? "Device" : "iCloud");
  return apiKey;
}

async function lunchMoneyGetPendingTransactions() {
  const url = `${BASE_URL}/v1/transactions`;
  const params = {
    limit: 50,
    status: "uncleared"
  };
  try {
    const response = await sendLunchMoneyRequest(url, params);
    return response.transactions.length;
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function lunchMoneyGetAssetsInfo() {
  const url = `${BASE_URL}/v1/assets`;
  try {
    const res = await sendLunchMoneyRequest(url);
    let manualLastUpdate = new Date();
    let account = "";
    res.assets.forEach(acc => {
      const thisAccount = new Date(acc.balance_as_of);
      if (thisAccount < manualLastUpdate) {
        manualLastUpdate = thisAccount;
        account = acc.display_name ?? acc.name;
      }
    });
    
    const value = getReadableDate(manualLastUpdate) + " - " + account;
    
    return {
      manualOldestUpdate: value
    }
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function lunchMoneyGetPlaidAccountsInfo() {
  const ignore = ["active", "inactive", "syncing"];
  const url = `${BASE_URL}/v1/plaid_accounts`;
  try {
    const response = await sendLunchMoneyRequest(url);
    let oldestUpdate = new Date();
    response.plaid_accounts.forEach(account => {
      const lastUpdate = new Date(account.balance_last_update);
      if (lastUpdate < oldestUpdate) oldestUpdate = lastUpdate;
    });
    
    return {
      accountsInError: response.plaid_accounts
        .filter(account => !ignore.some(ig => ig === account.status))
        .length,
      plaidOldestUpdate: getReadableDate(oldestUpdate)
    }
  } catch (e) {
    console.error(e);
    return null;
  }
}

//TODO calculating income and expenses should not go through the budget endpoint
async function lunchMoneyGetIncomeAndExpenseData() {
  // savings rate, income, total spent
  const url = `${BASE_URL}/v1/transactions`;
  const dates = USE_PAY_CYCLE ? getStartAndEndDateForPayCycle() : null;
  const params = { ...dates};
  var income = 0;
  var spent = 0
  
  try {
    const response = await sendLunchMoneyRequest(url, params);

    const lastTransactions = [];
    const maxLastTransactions = 8;
    let currentIndex = 0;

    var limit = response?.transactions?.length - 1;
    for(var i = limit; i >= 0; i--)
    {
      var transaction = response.transactions[i];

      // display transaction in widget: IF NOT a group transaction AND NOT a splitted transaction
      if((transaction.is_group == false && !transaction.hasChildren) && currentIndex < maxLastTransactions){
        lastTransactions[currentIndex++] = transaction;
        // console.log(transaction);
      }
      
      // use transaction for calculating totals: IF transaction is excluded from totals OR is a split transaction OR is a group transaction
      if(transaction.exclude_from_totals || transaction.hasChildren || transaction.group_id != null){
        continue;
      }
      console.log(transaction)
      if(transaction.is_income) {
        // for some reason positive amount come with a negative value and vice versa
        income += -transaction.to_base;
      }
      else{
        spent += transaction.to_base;
      }

      // console.log(`${i}. ${transaction.notes}`);

      if(USE_PAY_CYCLE && transaction.is_income && transaction.notes == PAY_CYCLE_ID){
        //console.log(`Salary found by ${transaction.payee}`);
        break;
      }
    }

    return {
      income: income.toFixed(2),
      spent: spent.toFixed(2),
      savings: income > 0 ? ((income - spent) / income * 100).toFixed(2)+`%` : "0",
      total: (income - spent).toFixed(2),
      lastTransactions: lastTransactions
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

function sendLunchMoneyRequest(url, params = {}) {
  var headers;
  if(LM_ACCESS_TOKEN.includes("Bearer")){
    headers = {
      'Authorization': LM_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    };
  }
  else{
    headers = {
      'Authorization': `Bearer ${LM_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    };
  }

  return sendHTTPRequest(url, params, headers);
}

function sendHTTPRequest(url, params, headers, method = 'GET') {
  let query = ``;
  Object.keys(params).forEach((key, i) => {
    const value = params[key];
    query += i === 0 ? '?' : '&';
    query += `${key}=${value}`;
  });
  const request = new Request(url + query);
  //console.log(`Request to: ${url + query}`);
  request.headers = headers;
  request.method = method;
  
  return request.loadJSON();
}

/****************************************************
            Utilities
*****************************************************/

function getStartAndEndDateForPayCycle() {
  const now = new Date();
  let month = now.getMonth();
  let day = now.getDate();
  if(day<10)day="0"+day;
  const prevMonthStr = month < 10 ? "0" + month : month;
  month++;
  const currentMonthStr = month < 10 ? "0" + month : month;
  const start_date = `${now.getFullYear()}-${prevMonthStr}-01`;
  //console.log(`start_date: ${start_date}`);
  const end_date = `${now.getFullYear()}-${currentMonthStr}-${day}`;
  //console.log(`end_date: ${end_date}`);
return {start_date, end_date};
}

function getReadableDate(date) {
  const now = new Date();
  const diff = now.valueOf() - date.valueOf();
  const hours = Math.round(hrs = diff / 3600000);
  return hours > 24 ? `${Math.round(hours / 24)} days` : `${hours} hours`;
}

/****************************************************
            File Management
*****************************************************/

function saveToFile(content, key, storage = "iCloud") {
    const folder = iCloud.documentsDirectory() + "/LunchMoneyWidget";
    const filePath = folder + `/${key}`;
    
    if (storage === "iCloud") {
      iCloud.createDirectory(folder, true);
      iCloud.writeString(filePath, content);
    }
    else {
      local.createDirectory(folder, true);
      local.writeString(filePath, content)
    }
}

async function readString(filePath, storage) {
  if (storage === ICLOUD) {
    const file = `${iCloud.documentsDirectory()}/${filePath}`;
    await iCloud.downloadFileFromiCloud(file)
    return iCloud.readString(file);
  }
  else {
    return local.readString(local.documentsDirectory() + "/" + filePath);
  }
}

function doesFileExist(filePath) {
  if (iCloud.fileExists(iCloud.documentsDirectory() +  "/" + filePath)) {
    return ICLOUD;
  }
  if (local.fileExists(local.documentsDirectory() + "/" + filePath)) {
    return LOCAL;
  }
  return false;
}

function Cache(storage) {
  const fileManager = storage === ICLOUD
    ? FileManager.iCloud()
    : FileManager.local();
    
  const documentsDirectory = fileManager.documentsDirectory();
    
  const set = (key, content) => {
    const folder = documentsDirectory + "/" + BASE_FILE;
    fileManager.createDirectory(folder, true);
    fileManager.writeString(folder + "/" + key, content);
    // console.log(`save to cache: ${folder + "/" + key}`)
    // console.log(content);
  }
  
  const get = (key, cutOffTimeInMs) => {
    const cacheFilePath = documentsDirectory + "/" + BASE_FILE + "/" + key;
    const cacheCutOffDate = new Date(Date.now() - cutOffTimeInMs);
    const dateOfCacheModification = fileManager.modificationDate(cacheFilePath);
    const getFromCache = dateOfCacheModification > cacheCutOffDate;
    //Debug cache info
    // console.log(`Cache expired: ${!getFromCache}`);
    // console.log(`Cache read at: ${cacheFilePath}`);
    // console.log(`Cache last modified: \t${dateOfCacheModification}`);
    // console.log(`Cache expiry date: \t${cacheCutOffDate}`);
    try {
      return getFromCache
        ? fileManager.readString(cacheFilePath)
        : null;
    } catch(e) {
      console.error(e);
      return null;
    }
  }

  const forceGet = (key) => {
    const cacheFilePath = documentsDirectory + "/" + BASE_FILE + "/" + key;
    try {
      return fileManager.readString(cacheFilePath);
    } catch(e) {
      console.error(e);
      return null;
    }
  }
  
  return { set, get, forceGet };
}

/****************************************************
            Widget Layouts
*****************************************************/

function initLayout()
{
  let Layout = {};
  Layout.medium = function(mainStack, lunchMoneyData){
    // HEADER
    const headingStack = mainStack.addStack();
    headingStack.layoutHorizontally();
    headingStack.addSpacer();
    const headerText = headingStack.addText(`💰 LUNCH MONEY - ${USE_PAY_CYCLE ? "Current Pay cycle" : MONTHS[new Date().getMonth()]} 💰`);
    headingStack.addSpacer();
    headerText.font = regularFont;
    headerText.textColor = regularColor;
    headerText.centerAlignText();  
    mainStack.addSpacer(2);
    
    // INCOME
    const incomeStack = mainStack.addStack();
    incomeStack.layoutHorizontally();
    const incomeText = incomeStack.addText("🟢 Total Income: ");
    incomeText.font = regularFont;
    incomeText.textColor = regularColor;
    incomeStack.addSpacer();
    const incomeNum = incomeStack.addText(lunchMoneyData.income);
    incomeNum.font = regularFont;
    incomeNum.textColor = Color.green();
    incomeNum.rightAlignText();

    // EXPENSES
    const expenseStack = mainStack.addStack();
    expenseStack.layoutHorizontally();
    const expenseText = expenseStack.addText("🔴 Total Expenses: ");
    expenseText.font = regularFont;
    expenseText.textColor = regularColor;
    expenseStack.addSpacer();
    const expenseNum = expenseStack.addText(lunchMoneyData.spent);  
    expenseNum.font = regularFont;
    expenseNum.textColor = Color.red();
    expenseNum.rightAlignText();

    // TOTAL
    const totalStack = mainStack.addStack();
    totalStack.layoutHorizontally();
    const totalText = totalStack.addText("💰 Net Income: ");
    totalText.font = regularFont;
    totalText.textColor = regularColor;
    totalStack.addSpacer();
    const totalNum = totalStack.addText(lunchMoneyData.total);  
    totalNum.font = regularFont;
    totalNum.textColor = parseFloat(lunchMoneyData.total) >= 0 ? Color.green() : Color.red();
    totalNum.rightAlignText();

    // SAVINGS
    const savingsStack = mainStack.addStack();
    savingsStack.layoutHorizontally();
    const savingsText = savingsStack.addText("🏦 Savings rate: ");
    savingsText.font = regularFont;
    savingsText.textColor = regularColor;
    savingsStack.addSpacer();
    const savingsNum = savingsStack.addText(lunchMoneyData.savings);
    savingsNum.font = regularFont;
    savingsNum.textColor = lunchMoneyData.savings?.startsWith('-') ? Color.red() : Color.green();
    savingsNum.rightAlignText();
    
    // PENDING TRANSACTIONS
    if(lunchMoneyData.pendingTransactions > 0){
      const transactionsStack = mainStack.addStack();
      transactionsStack.layoutHorizontally();
      const transactionsText = transactionsStack.addText("⏳ Pending Reviews:");
      transactionsText.font = regularFont;
      transactionsText.textColor = regularColor;
      transactionsStack.addSpacer();
      const pendingNum = transactionsStack.addText(lunchMoneyData.pendingTransactions.toString());
      pendingNum.font = regularFont;
      pendingNum.textColor = regularColor;
      pendingNum.rightAlignText();
    }
    
    // SYNC ERROR
    if(lunchMoneyData.accountsInError > 0)
    {
      const message = mainStack.addText(`❗ Sync Error(s) in ${lunchMoneyData.accountsInError} Account(s).`);
      message.font = regularFont;
      message.textColor = Color.red();
    }
    // ACCOUNT UPDATES
    else{
    const oldestUpdates = mainStack.addText(`Oldest Balance Syncs`);
    oldestUpdates.textColor = regularColor;
    oldestUpdates.font = regularFont;

    const plaid = mainStack.addText(`     - Plaid: ${lunchMoneyData.plaidOldestUpdate}`);
    plaid.font = smallFont;
    plaid.textColor = regularColor;
    
    const manual = mainStack.addText(`     - Manual: ${lunchMoneyData.manualOldestUpdate}`);
    manual.font = smallFont;
    manual.textColor = regularColor;
    }
  }

  Layout.small = function (mainStack, lunchMoneyData){
    // HEADER
    const headingStack = mainStack.addStack();
    headingStack.layoutHorizontally();
    //headingStack.centerAlignContent();
    headingStack.addSpacer();
    const headerText = headingStack.addText("LUNCH MONEY");
    //headerText.centerAlignText();
    headingStack.addSpacer();
    headerText.font = regularFont;
    headerText.textColor = regularColor;
    headerText.centerAlignText(); 
    mainStack.addSpacer(5);

    // INCOME
    const incomeStack = mainStack.addStack();
    incomeStack.layoutHorizontally();
    const incomeText = incomeStack.addText("🟢");
    incomeText.font = regularFont;
    incomeText.textColor = regularColor;
    incomeStack.addSpacer();
    const incomeNum = incomeStack.addText(lunchMoneyData.income);
    incomeNum.font = regularFont;
    incomeNum.textColor = Color.green();
    incomeNum.rightAlignText();

    // EXPENSES
    const expenseStack = mainStack.addStack();
    expenseStack.layoutHorizontally();
    const expenseText = expenseStack.addText("🔴");
    expenseText.font = regularFont;
    expenseText.textColor = regularColor;
    expenseStack.addSpacer();
    const expenseNum = expenseStack.addText(lunchMoneyData.spent);  
    expenseNum.font = regularFont;
    expenseNum.textColor = Color.red();
    expenseNum.rightAlignText();

    // TOTAL
    const totalStack = mainStack.addStack();
    totalStack.layoutHorizontally();
    const totalText = totalStack.addText("💰");
    totalText.font = regularFont;
    totalText.textColor = regularColor;
    totalStack.addSpacer();
    const totalNum = totalStack.addText(lunchMoneyData.total);  
    totalNum.font = regularFont;
    totalNum.textColor = parseFloat(lunchMoneyData.total) >= 0 ? Color.green() : Color.red();
    totalNum.rightAlignText();

    // SAVINGS
    const savingsStack = mainStack.addStack();
    savingsStack.layoutHorizontally();
    const savingsText = savingsStack.addText("🏦");
    savingsText.font = regularFont;
    savingsText.textColor = regularColor;
    savingsStack.addSpacer();
    const savingsNum = savingsStack.addText(lunchMoneyData.savings);
    savingsNum.font = regularFont;
    savingsNum.textColor = lunchMoneyData.savings?.startsWith('-') ? Color.red() : Color.green();
    savingsNum.rightAlignText();

    // PENDING TRANSACTIONS
    if(lunchMoneyData.pendingTransactions > 0){
      mainStack.addSpacer(5);
      const transactionsStack = mainStack.addStack();
      transactionsStack.layoutHorizontally();
      const transactionsText = transactionsStack.addText("⏳");
      transactionsText.font = regularFont;
      transactionsText.textColor = regularColor;
      transactionsStack.addSpacer();
      const pendingNum = transactionsStack.addText(lunchMoneyData.pendingTransactions.toString());
      pendingNum.font = regularFont;
      pendingNum.textColor = regularColor;
      pendingNum.rightAlignText();
    }

    // ERROR
    if(lunchMoneyData.accountsInError > 0){
        const message = mainStack.addText(`❗ Sync Error`);
        message.font = regularFont;
        message.textColor = Color.red();
    }

    mainStack.addSpacer();
  }

  Layout.large = function(mainStack, lunchMoneyData){
    Layout.medium(mainStack, lunchMoneyData);

    mainStack.addSpacer(10);
    const t = mainStack.addText("-------------------------------------------");
    t.font = regularFont;
    t.textColor = regularColor;
    mainStack.addSpacer(5);

    const transactions = lunchMoneyData.lastTransactions;

    for (let i = 0; i < transactions.length; i++){
      addTransactionRow(transactions[i], mainStack);
    }

    mainStack.addSpacer();
  }

  Layout.extraLarge = Layout.large;
  //when running the script from the app config.widgetFamily is undefined, don't excute layout logic in that case
  Layout.undefined = function(mainStack, lunchMoneyData){};
  return Layout;
}

function addTransactionRow(transaction, mainStack){
  const line = mainStack.addStack();
  line.layoutHorizontally();

  let t = line.addText(`${transaction["date"]} ${transaction["payee"]}`);
  t.font = regularFont;
  t.textColor = regularColor;

  line.addSpacer();

  let t2 = line.addText((-transaction["to_base"]).toFixed(2).toString());
  t2.font = regularFont;
  t2.textColor = regularColor;
  t2.rightAlignText();
}