Disclaimer: I had too much time on my hands and wanted to fix some issues with this nice widget from @aryascripts.

# Lunch Money Widget
An iOS Widget for LunchMoney Status updates, a quick glance that you can have on your phone or iPad.

![Lunch Money Widget](https://user-images.githubusercontent.com/3420290/121816572-6a6b5f80-cc4a-11eb-9b41-f398639fb60c.jpeg)

## How to Use
Currently, I am working on adding this script to the `Scriptable`'s Library. For now, you would need to copy the script and place it into the Scriptable's UI.

1. Download [Scriptable](https://scriptable.app)
2. Add new script
3. Copy and paste the contets of [index.js](https://github.com/amanb014/lunch-money-widget/blob/main/index.js) and save
4. Run the script, this will pop up an alert box
5. Paste your [API key from LunchMoney](https://my.lunchmoney.app/developers)
6. Choose where you want to save the key (Device or iCloud)
7. Add a new widget to the home screen
8. Select a widget size, all sizes are supported
9. Select LunchMoneyWidget from the list
10. Enjoy!

__Optional:__ Instead of having the total values calculated for the current calendar month its possible to define a monthly (salary) payment which will be used as the start of a cycle. Useful if you get a salary at the end of a month, like me and the widget would show zero income for the most part of the month. You need to put a string in the `notes` field of those transactions, like *"salary"*, for example and then use that same string as a parameter in the widget settings. Totals will be calculated starting with that transaction then. 

Note: the information is cached in iCloud for 2 hours. 

### How to Use (Video)
[How to Video](https://user-images.githubusercontent.com/3420290/121816934-79eba800-cc4c-11eb-8d0f-fdbeab00ca3e.MOV)

