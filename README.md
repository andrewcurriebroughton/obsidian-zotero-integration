This fork adds GROBID support (https://grobid.readthedocs.io/en/latest/Introduction/) for analyzing a paper's reference data and extracts it so that it can be accessed from the `referenceTitles` Nunjucks template variable. To enable, toggle the "Analyze References" option in the plugin's settings. Java and GROBID must be installed, and GROBID needs to be running on `http://localhost:8070`. At the moment, only the reference titles are extracted, but this could be extended to include the other GROBID routes.

## Obsidian Zotero Integration

Insert and import citations, bibliographies, notes, and PDF annotations from Zotero into Obsidian. Requires the [Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/installation/) plugin.

You can find the documentation for this plugin [here](https://github.com/mgmeyers/obsidian-zotero-integration/blob/main/docs/README.md). The documentation is currently incomplete. Please reach out if you'd like to help.

## Help, how do I install the plugin?

In Obsidian, open Settings, on the left under Options open Community Plugins, on Community Plugins select Browse and search for 'Zotero Integration'

## Help, the plugin doesn't load!

Please insure your Obsidian installer version is at least `v0.13.24`. If not, try reinstalling obsidian.

## Help, I get an error when creating a citation or bibliography!

Please ensure you have selected a quick copy style in Zotero:

<img src="https://raw.githubusercontent.com/mgmeyers/obsidian-zotero-integration/main/screenshots/04.png" alt="A screenshot Zotero's quick copy settings">

And that you can copy a citation in Zotero when and item is selected:

<img src="https://raw.githubusercontent.com/mgmeyers/obsidian-zotero-integration/main/screenshots/05.png" alt="A screenshot Zotero's edit menu showing the copy citation option">


## Screenshots

<img src="https://raw.githubusercontent.com/mgmeyers/obsidian-zotero-integration/main/screenshots/01.png" alt="A screenshot of this plugin's settings">

<img src="https://raw.githubusercontent.com/mgmeyers/obsidian-zotero-integration/main/screenshots/02.png" alt="A screenshot of available plugin commands">

<img src="https://raw.githubusercontent.com/mgmeyers/obsidian-zotero-integration/main/screenshots/03.png" alt="A screenshot of the Zotero search bar">

<img src="https://raw.githubusercontent.com/mgmeyers/obsidian-zotero-integration/main/screenshots/demo.gif" alt="A short gif demonstraiting importing notes form Zotero into the current file">
