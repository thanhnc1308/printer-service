const axios = require("axios").default;
const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const winston = require("winston");
require("winston-daily-rotate-file");
const sharp = require("sharp");
const ThermalPrinter = require("node-thermal-printer").printer;
const Types = require("node-thermal-printer").types;
const receiptline = require("receiptline");
const moment = require("moment-timezone");
let config;

const logger = winston.createLogger({
  level: "debug",
  transports: [
    new winston.transports.Console(),
    new winston.transports.DailyRotateFile({
      filename: "application-%DATE%.log",
      datePattern: "YYYY-MM-DD-HH",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    }),
  ],
});

const defaultTimeZone = "Asia/Ho_Chi_Minh";
const formatDate = (datetime, format) => {
  if (!datetime) {
    return "";
  }
  moment.locale("en");
  return moment(datetime).tz(defaultTimeZone).format(format);
};
const formatDateTimeYyyymmddHHmmss = (dateTime) =>
  formatDate(dateTime, "HH:mm");

const formatDateStr = (str) => {
  try {
    return formatDateTimeYyyymmddHHmmss(new Date(str));
  } catch (error) {
    return str;
  }
};

const formatedPrice = (price) => Intl.NumberFormat("de-DE").format(price);
const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

const generateSgvFor58mmPrinter = (orderSession, printer, isPreview) => {
  const restaurantName = _.get(orderSession, "restaurantName");
  const restaurantAddress = _.get(orderSession, "restaurantAddress");
  const billNo = _.get(orderSession, "billNo");
  const representativeName = _.get(orderSession, "representativeName");
  const representativePhone = _.get(orderSession, "representativePhone");
  const createdAt = _.get(orderSession, "createdAt");
  const numberOfCustomers = _.get(orderSession, "numberOfCustomers");
  const tableNames = _.get(orderSession, "tableNames").join(",");
  const pretaxPaymentAmount = _.get(orderSession, "pretaxPaymentAmount");
  const taxPaymentAmount = _.get(orderSession, "taxPaymentAmount");
  const paymentAmount = _.get(orderSession, "paymentAmount");
  const customerPaidAmount = _.get(orderSession, "customerPaidAmount");
  const returnAmount = _.get(orderSession, "returnAmount");
  const orderDetailNumber = _.get(orderSession, "orderDetailNumber") || 0;
  const isNewOrder = orderDetailNumber > 0;

  // printer information
  const doNotIncludePriceInBill = _.get(printer, "doNotIncludePriceInBill");
  const includeNoteInBill = _.get(printer, "includeNoteInBill");
  const includeOrderDetailNumber = _.get(printer, "includeOrderDetailNumber");
  const dishTypes = _.get(printer, "dishTypes");

  let text = `
  {width:auto,t: wrap}
|"${restaurantName}|\n`;
  if (restaurantAddress) {
    text += `|${restaurantAddress}|\n`;
  }
  text += `
-
|"^^^HÓA ĐƠN|
|"Mã ĐH:${billNo}|

{width:16,16}
|"${representativeName} | ${formatDateStr(createdAt)}|
|${representativePhone} |
|Số người: ${numberOfCustomers} | Bàn: ${tableNames}|
-
{border:space; width:18,2,12;t: wrap}
|"Món          |"SL|     "Thành tiền|
-
`;
  const orderDetails = _.get(orderSession, "orderDetails");
  _.flatMap(orderDetails, (o) => o.dishOrder).forEach((dishOrder) => {
    if (dishTypes.includes(dishOrder.dishType)) {
      // eslint-disable-next-line prettier/prettier
      text += `|${dishOrder.dishName} |"${dishOrder.quantity}| "${
        !doNotIncludePriceInBill ? formatedPrice(dishOrder.price) : ""
      }|\n`;
      if (includeNoteInBill && dishOrder.note) {
        text += `{w:auto; t: wrap}\n`;
        text += `|${dishOrder.note}\n`;
      }
      text += `\n`;
      text += `{border:space; width:18,2,12;t: wrap}\n`;
    }
  });
  if (!isNewOrder && !isPreview && !doNotIncludePriceInBill) {
    text += `-
    {border:space; width:16,16 ;t: wrap}
    |Tổng | ${pretaxPaymentAmount}|`;
    if (taxPaymentAmount > 0) {
      text += `|VAT | ${formatedPrice(taxPaymentAmount)}|\n`;
    }
    text += `
    -
    |"Tổng tiền | "${formatedPrice(paymentAmount)}|
    `;
    if (customerPaidAmount > 0) {
      text += `
      -
      |Tiền khách đưa | ${formatedPrice(customerPaidAmount)}|
      |Trả lại | ${formatedPrice(returnAmount)}|
      `;
    }
  }

  text += `
|{i:iVBORw0KGgoAAAANSUhEUgAAALQAAAA5CAYAAACf4wE0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAGsGlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0MzYwLCAyMDIwLzAyLzEzLTAxOjA3OjIyICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjEuMSAoV2luZG93cykiIHhtcDpDcmVhdGVEYXRlPSIyMDIyLTA1LTE2VDE0OjMzOjUwKzA3OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyMi0wNS0xNlQxNjozODozNiswNzowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyMi0wNS0xNlQxNjozODozNiswNzowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIHBob3Rvc2hvcDpJQ0NQcm9maWxlPSJzUkdCIElFQzYxOTY2LTIuMSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpjNmE2NjE0Ny0xMmI1LWQ5NGQtYjYwOC1hZjI4MDgyODY5NWEiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6NWE4MzI4YzYtNDJlZi04MTQ5LTgwMTgtNGI2Yjg1ZGQxNWQwIiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6NWE4MzI4YzYtNDJlZi04MTQ5LTgwMTgtNGI2Yjg1ZGQxNWQwIj4gPHhtcE1NOkhpc3Rvcnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDo1YTgzMjhjNi00MmVmLTgxNDktODAxOC00YjZiODVkZDE1ZDAiIHN0RXZ0OndoZW49IjIwMjItMDUtMTZUMTQ6MzM6NTArMDc6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyMS4xIChXaW5kb3dzKSIvPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6NDVkMTkyNGUtNDRkYy1iYjRlLTkxZWQtMzA0YjY1ZWZmNDE3IiBzdEV2dDp3aGVuPSIyMDIyLTA1LTE2VDE2OjI4OjA3KzA3OjAwIiBzdEV2dDpzb2Z0d2FyZUFnZW50PSJBZG9iZSBQaG90b3Nob3AgMjEuMSAoV2luZG93cykiIHN0RXZ0OmNoYW5nZWQ9Ii8iLz4gPHJkZjpsaSBzdEV2dDphY3Rpb249InNhdmVkIiBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOmM2YTY2MTQ3LTEyYjUtZDk0ZC1iNjA4LWFmMjgwODI4Njk1YSIgc3RFdnQ6d2hlbj0iMjAyMi0wNS0xNlQxNjozODozNiswNzowMCIgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUGhvdG9zaG9wIDIxLjEgKFdpbmRvd3MpIiBzdEV2dDpjaGFuZ2VkPSIvIi8+IDwvcmRmOlNlcT4gPC94bXBNTTpIaXN0b3J5PiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PoaSyUgAAAnBSURBVHic7Z3tdZy6Foafc1f+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}|

{width:auto;border:line;align:center}\n`;
  if (includeOrderDetailNumber && orderDetailNumber) {
    text += `|"Lần ${orderDetailNumber}|\n`;
  }
  text += `=`;

  const svg = receiptline.transform(text, {
    cpl: 32,
    encoding: "multilingual",
    spacing: true,
  });
  return svg;
};

const generateSgvFor80mmPrinter = (orderSession, printer, isPreview) => {
  const restaurantName = _.get(orderSession, "restaurantName");
  const restaurantAddress = _.get(orderSession, "restaurantAddress");
  const billNo = _.get(orderSession, "billNo");
  const representativeName = _.get(orderSession, "representativeName");
  const representativePhone = _.get(orderSession, "representativePhone");
  const createdAt = _.get(orderSession, "createdAt");
  const numberOfCustomers = _.get(orderSession, "numberOfCustomers");
  const tableNames = _.get(orderSession, "tableNames").join(",");
  const pretaxPaymentAmount = _.get(orderSession, "pretaxPaymentAmount");
  const taxPaymentAmount = _.get(orderSession, "taxPaymentAmount");
  const paymentAmount = _.get(orderSession, "paymentAmount");
  const customerPaidAmount = _.get(orderSession, "customerPaidAmount");
  const returnAmount = _.get(orderSession, "returnAmount");
  const orderDetailNumber = _.get(orderSession, "orderDetailNumber") || 0;
  const isNewOrder = orderDetailNumber > 0;

  // printer information
  const doNotIncludePriceInBill = _.get(printer, "doNotIncludePriceInBill");
  const includeNoteInBill = _.get(printer, "includeNoteInBill");
  const includeOrderDetailNumber = _.get(printer, "includeOrderDetailNumber");
  const dishTypes = _.get(printer, "dishTypes");

  let text = `
  {width:auto,t: wrap}
|"${restaurantName}|\n`;
  if (restaurantAddress) {
    text += `|${restaurantAddress}|\n`;
  }
  text += `
-
|"^^^HÓA ĐƠN|
|"Mã ĐH:${billNo}|

{width:25,23}
|"${representativeName} | ${formatDateStr(createdAt)}|
|${representativePhone} |
|Số người: ${numberOfCustomers} | Bàn: ${tableNames}|
-
{border:space; width:33,2,12;t: wrap}
|"Món          |"SL|     "Thành tiền|
-
`;
  const orderDetails = _.get(orderSession, "orderDetails");
  _.flatMap(orderDetails, (o) => o.dishOrder).forEach((dishOrder) => {
    if (dishTypes.includes(dishOrder.dishType)) {
      // eslint-disable-next-line prettier/prettier
      text += `|${dishOrder.dishName} |"${dishOrder.quantity}| "${
        !doNotIncludePriceInBill ? formatedPrice(dishOrder.price) : ""
      }|\n`;
      if (includeNoteInBill && dishOrder.note) {
        text += `{w:auto; t: wrap}\n`;
        text += `|${dishOrder.note}\n`;
      }
      text += `\n`;
      text += `{border:space; width:33,2,12;t: wrap}\n`;
    }
  });
  if (!isNewOrder && !isPreview && !doNotIncludePriceInBill) {
    text += `-
    {border:space; width:20,28 ;t: wrap}
    |Tổng | ${pretaxPaymentAmount}|`;
    if (taxPaymentAmount > 0) {
      text += `|VAT | ${formatedPrice(taxPaymentAmount)}|\n`;
    }
    text += `
    -
    |"Tổng tiền | "${formatedPrice(paymentAmount)}|
    `;
    if (customerPaidAmount > 0) {
      text += `
      -
      |Tiền khách đưa | ${formatedPrice(customerPaidAmount)}|
      |Trả lại | ${formatedPrice(returnAmount)}|
      `;
    }
  }

  text += `
|{i:iVBORw0KGgoAAAANSUhEUgAAALQAAAA5CAYAAACf4wE0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAGsGlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0MzYwLCAyMDIwLzAyLzEzLTAxOjA3OjIyICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjEuMSAoV2luZG93cykiIHhtcDpDcmVhdGVEYXRlPSIyMDIyLTA1LTE2VDE0OjMzOjUwKzA3OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyMi0wNS0xNlQxNjozODozNiswNzowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyMi0wNS0xNlQxNjozODozNiswNzowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIHBob3Rvc2hvcDpJQ0NQcm9maWxlPSJzUkdCIElFQzYxOTY2LTIuMSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpjNmE2NjE0Ny0xMmI1LWQ5NGQtYjYwOC1hZjI4MDgyODY5NWEiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6NWE4MzI4YzYtNDJlZi04MTQ5LTgwMTgtNGI2Yjg1ZGQxNWQwIiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6NWE4MzI4YzYtNDJlZi04MTQ5LTgwMTgtNGI2Yjg1ZGQxNWQwIj4gPHhtcE1NOkhpc3Rvcnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDo1YTgzMjhjNi00MmVmLTgxNDktODAxOC00YjZiODVkZDE1ZDAiIHN0RXZ0OndoZW49IjIwMjItMDUtMTZUMTQ6MzM6NTArMDc6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyMS4xIChXaW5kb3dzKSIvPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6NDVkMTkyNGUtNDRkYy1iYjRlLTkxZWQtMzA0YjY1ZWZmNDE3IiBzdEV2dDp3aGVuPSIyMDIyLTA1LTE2VDE2OjI4OjA3KzA3OjAwIiBzdEV2dDpzb2Z0d2FyZUFnZW50PSJBZG9iZSBQaG90b3Nob3AgMjEuMSAoV2luZG93cykiIHN0RXZ0OmNoYW5nZWQ9Ii8iLz4gPHJkZjpsaSBzdEV2dDphY3Rpb249InNhdmVkIiBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOmM2YTY2MTQ3LTEyYjUtZDk0ZC1iNjA4LWFmMjgwODI4Njk1YSIgc3RFdnQ6d2hlbj0iMjAyMi0wNS0xNlQxNjozODozNiswNzowMCIgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUGhvdG9zaG9wIDIxLjEgKFdpbmRvd3MpIiBzdEV2dDpjaGFuZ2VkPSIvIi8+IDwvcmRmOlNlcT4gPC94bXBNTTpIaXN0b3J5PiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PoaSyUgAAAnBSURBVHic7Z3tdZy6Foafc1f+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}|

{width:auto;border:line;align:center}\n`;
  if (includeOrderDetailNumber && orderDetailNumber) {
    text += `|"Lần ${orderDetailNumber}|\n`;
  }
  text += `=`;

  const svg = receiptline.transform(text, {
    cpl: 48,
    encoding: "multilingual",
    spacing: true,
  });
  return svg;
};

const writeSvgTofile = async (fileName, svg) => {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFile(fileName, svg, (err) => {
      // throws an error, you could also catch it here
      if (err) reject(err);
      resolve();
    });
  });
};

const convertSvgToPng = async ({ inFile, outFile }) => {
  return new Promise((resolve, reject) => {
    sharp(inFile)
      .png()
      .toFile(outFile)
      .then(function (info) {
        console.log(info);
        resolve(outFile);
      })
      .catch(function (err) {
        console.log(err.stack);
        reject();
      });
  });
};

const printOrder = async ({ orderSession, printer, isPreview, jobFolder }) => {
  const timeStammp = new Date().getTime();
  console.log(`printOrder jobFolder = ${jobFolder}`);
  const svgFile = `${jobFolder}/${timeStammp}.svg`;
  const pngFile = `${jobFolder}/${timeStammp}.png`;
  const _printerHost = printer.printerHost;
  const _printerPort = printer.printerPort;
  const _size = printer.size;
  const _cpl = _size === 58 ? 32 : 48;
  console.log(`_cpl = ${_cpl}`);
  const thermalPrinter = new ThermalPrinter({
    type: Types.EPSON, // 'star' or 'epson'
    interface: `tcp://${_printerHost}:${_printerPort}`,
    options: {
      timeout: 20000,
    },
    width: _cpl, // Number of characters in one line - default: 48
    characterSet: "SLOVENIA", // Character set - default: SLOVENIA
    removeSpecialCharacters: false, // Removes special characters - default: false
    lineCharacter: "-", // Use custom character for drawing lines - default: -
  });

  const isConnected = await thermalPrinter.isPrinterConnected();
  console.log(`Connected: ${isConnected}`);
  let svg;
  if (_size === 58) {
    svg = generateSgvFor58mmPrinter(orderSession, printer, isPreview);
  } else {
    svg = generateSgvFor80mmPrinter(orderSession, printer, isPreview);
  }

  await writeSvgTofile(svgFile, svg);
  await convertSvgToPng({ inFile: svgFile, outFile: pngFile });
  await sleep(1000);

  // console.log(pngFile);
  thermalPrinter.alignCenter();
  await thermalPrinter.printImage(pngFile);

  await thermalPrinter.cut();

  try {
    await thermalPrinter.execute();
  } catch (error) {
    console.log(error);
  }
};

const processOrder = async ({
  orderSession,
  printerInfo,
  isPreview,
  jobFolder,
}) => {
  console.log(`processOrder jobFolder = ${jobFolder}`);
  // eslint-disable-next-line no-restricted-syntax
  for (const printer of printerInfo) {
    await printOrder({ orderSession, printer, isPreview, jobFolder }); // eslint-disable-line
  }
};

const deleteAllFile = async (directory) => {
  console.log(`delete all files in ${directory}`);
  return new Promise((resolve, reject) => {
    fs.readdir(directory, (err, files) => {
      if (err) reject(err);

      for (const file of files) {
        fs.unlink(path.join(directory, file), (err) => {
          if (err) reject(err);
        });
      }
      resolve();
    });
  });
};

const fetchPrinterJob = async (config) => {
  const { baseUrl, restaurantId, jwtToken, jobFolder } = config;
  const printerJobUrl = `${config.baseUrl}/restaurants/${restaurantId}/getPrinterJob`;
  const httpClient = axios.create({
    timeout: 10000,
    headers: {
      "Content-Type": "application/json",
      appid: "mmenu-admin",
      authorization: `Bearer ${jwtToken}`,
    },
  });
  const fetchResult = await httpClient.get(printerJobUrl);
  return fetchResult.data;
};

const runProcess = async (config) => {
  const jobResult = await fetchPrinterJob(config);

  console.log("jobResult");
  console.log(jobResult);
  const jobData = JSON.parse(jobResult.sqsMessage);
  if (_.get(jobData, "printerInfo")) {
    const { jobFolder } = config;
    await deleteAllFile(jobFolder);
    console.log(jobData);
    jobData.jobFolder = jobFolder;
    await processOrder(jobData);
  }
};

const startService = async () => {
  try {
    config = {
      jwtToken:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2MjQyNjkwYmU5ZGYwNGQxMmQ2NDk0MzQiLCJpYXQiOjE2NTI5MjcxNzIsImV4cCI6NDcwOTQ5MjA3NzIsInR5cGUiOiJhY2Nlc3MifQ.uyOtLYrTW0V48fkk3vCvPUpYl997L3EuMOSXGQy1aak",
      restaurantId: "62426976aae98997b5416377",
      baseUrl: "https://api.mmenu.io/v2",
      interval: 5000,
      jobFolder: "./jobs",
    };
    logger.info("start printer service");
    logger.info(config);
    await runProcess(config);
  } catch (exception) {
    logger.error(exception.stack);
  } finally {
    setTimeout(() => startService(), _.get(config, "interval"));
  }
};

startService();
