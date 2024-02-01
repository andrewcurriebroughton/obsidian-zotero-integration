import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { Notice, TFile, htmlToMarkdown, moment, normalizePath } from 'obsidian';
import path from 'path';

import { doesEXEExist, getVaultRoot } from '../helpers';
import {
  DatabaseWithPort,
  ExportToMarkdownParams,
  RenderCiteTemplateParams,
  ZoteroConnectorSettings,
} from '../types';
import { applyBasicTemplates } from './basicTemplates/applyBasicTemplates';
import { CiteKey, getCiteKeyFromAny, getCiteKeys } from './cayw';
import { processZoteroAnnotationNotes } from './exportNotes';
import { extractAnnotations } from './extractAnnotations';
import {
  getColorCategory,
  getLocalURI,
  mkMDDir,
  sanitizeFilePath,
} from './helpers';
import {
  getAttachmentsFromCiteKey,
  getBibFromCiteKey,
  getCollectionFromCiteKey,
  getIssueDateFromCiteKey,
  getItemJSONFromCiteKeys,
  getItemJSONFromRelations,
} from './jsonRPC';
import { PersistExtension, renderTemplate } from './template.env';
import {
  appendExportDate,
  getExistingAnnotations,
  getLastExport,
  getTemplates,
  removeStartingSlash,
  wrapAnnotationTemplate,
} from './template.helpers';
import { getReferenceTitles } from 'src/grobid/processReferences';

async function processNote(
  citeKey: CiteKey,
  note: any,
  importDate: moment.Moment,
  database: DatabaseWithPort,
  cslStyle?: string
) {
  if (note.note) {
    note.note = htmlToMarkdown(
      await processZoteroAnnotationNotes(citeKey.key, note.note, {})
    );
  }
  if (note.dateAdded) {
    note.dateAdded = moment(note.dateAdded);
  }
  if (note.dateModified) {
    note.dateModified = moment(note.dateModified);
  }
  note.desktopURI = getLocalURI('select', note.uri);
  note.relations = await getRelations(
    note,
    citeKey.library,
    importDate,
    database,
    cslStyle
  );
}

function processAttachment(attachment: any) {
  if (attachment.dateAdded) {
    attachment.dateAdded = moment(attachment.dateAdded);
  }

  if (attachment.dateModified) {
    attachment.dateModified = moment(attachment.dateModified);
  }

  if (attachment.uri) {
    attachment.itemKey = attachment.uri.split('/').pop();
    attachment.desktopURI =
      attachment.select || getLocalURI('select', attachment.uri);

    if (attachment.path?.endsWith('.pdf')) {
      attachment.pdfURI = getLocalURI('open-pdf', attachment.uri);
    }
  }
}

function processAnnotation(
  annotation: any,
  attachment: any,
  imageRelativePath: any
) {
  annotation.date = moment(annotation.date);
  annotation.attachment = attachment;
  annotation.source = 'pdf';

  if (annotation.imagePath) {
    annotation.imageBaseName = path.basename(annotation.imagePath);
    annotation.imageExtension = path.extname(annotation.imagePath).slice(1);
    annotation.imageRelativePath = normalizePath(
      path.join(imageRelativePath, annotation.imageBaseName)
    );
  }

  annotation.desktopURI = getLocalURI('open-pdf', attachment.uri, {
    page: annotation.pageLabel,
  });
}

function convertNativeAnnotation(
  annotation: any,
  attachment: any,
  imageOutputPath: string,
  imageRelativePath: string,
  imageBaseName: string,
  copy: boolean = false
) {
  const rect = annotation.annotationPosition.rects[0];

  const annot: Record<string, any> = {
    date: moment(annotation.dateModified),
    attachment,
    page: annotation.annotationPosition.pageIndex + 1,
    pageLabel: annotation.annotationPageLabel,
    id: annotation.key,
    type: annotation.annotationType,
    x: rect[0],
    y: rect[1],
    color: annotation.annotationColor,
    colorCategory: getColorCategory(annotation.annotationColor),
    desktopURI: getLocalURI('open-pdf', attachment.uri, {
      page: annotation.annotationPageLabel,
      annotation: annotation.key,
    }),
    source: 'zotero',
  };

  if (annotation.annotationText) {
    annot.annotatedText = annotation.annotationText;
  }

  if (annotation.annotationComment) {
    annot.comment = annotation.annotationComment;
  }

  if (annotation.annotationImagePath) {
    const parsed = path.parse(annotation.annotationImagePath);

    annot.imageBaseName = `${imageBaseName}-${annot.page}-x${Math.round(
      annot.x
    )}-y${Math.round(annot.y)}${parsed.ext}`;
    annot.imageRelativePath = normalizePath(
      path.join(imageRelativePath, annot.imageBaseName)
    );
    annot.imageExtension = parsed.ext.slice(1);

    const imagePath = path.join(imageOutputPath, annot.imageBaseName);

    if (copy) {
      if (!existsSync(imageOutputPath)) {
        mkdirSync(imageOutputPath, { recursive: true });
      }

      let input = path.join(parsed.dir, `${annotation.key}${parsed.ext}`);
      try {
        if (!existsSync(input)) {
          const origInput = input;
          input = annotation.annotationImagePath;
          if (!existsSync(input)) {
            throw new Error('Cannot find annotation image: ' + origInput);
          }
        }

        copyFileSync(input, imagePath);
      } catch (e) {
        new Notice(
          'Error: unable to copy annotation image from Zotero into your vault',
          7000
        );
        console.error(e);
      }
    }

    annot.imagePath = imagePath;
  }

  if (annotation.tags?.length) {
    annot.tags = annotation.tags;
    annot.allTags = annotation.tags.map((t: any) => t.tag).join(', ');
    annot.hashTags = annotation.tags
      .map((t: any) => `#${t.tag.replace(/\s+/g, '-')}`)
      .join(', ');
  }

  return annot;
}

function concatAnnotations(annots: Array<Record<string, any>>) {
  const output: Array<Record<string, any>> = [];
  const re = /^\+\s*/;

  annots.forEach((a) => {
    if (typeof a.comment === 'string' && re.test(a.comment)) {
      a.comment = a.comment.replace(re, '');

      const last = output[output.length - 1];

      if (last) {
        last.annotatedText = last.annotatedText
          ? last.annotatedText + '...' + a.annotatedText
          : a.annotatedText;
        last.comment = last.comment
          ? last.comment + '...' + a.comment
          : a.comment;

        return;
      }
    }

    output.push(a);
  });

  return output;
}

async function getRelations(
  item: any,
  libraryID: any,
  importDate: moment.Moment,
  database: DatabaseWithPort,
  cslStyle?: string
) {
  if (item.relations && !Array.isArray(item.relations)) {
    const relations: string[] = [];
    for (const val of Object.values(item.relations)) {
      if (Array.isArray(val)) relations.push(...val);
    }
    item.relations = relations;
  }
  if (!item.relations?.length) return [];

  const relatedItems = await getItemJSONFromRelations(
    libraryID,
    item.relations,
    database
  );

  for (const related of relatedItems) {
    if (getCiteKeyFromAny(related)) {
      await processItem(related, importDate, database, cslStyle, true);
    }
  }

  return relatedItems;
}

async function processItem(
  item: any,
  importDate: moment.Moment,
  database: DatabaseWithPort,
  cslStyle?: string,
  skipRelations?: boolean,
  analyzeReferencesState?: boolean,
  skipUnavailableReferencesState?: boolean
) {
  const citekey = getCiteKeyFromAny(item);
  item.importDate = importDate;
  // legacy
  item.exportDate = importDate;
  item.desktopURI =
    item.select || getLocalURI('select', item.uri, item.itemKey);

  if (item.accessDate) {
    item.accessDate = moment(item.accessDate);
  }

  if (item.dateAdded) {
    item.dateAdded = moment(item.dateAdded);
  }

  if (item.dateModified) {
    item.dateModified = moment(item.dateModified);
  }

  if (citekey) {
    if (!item.citekey) {
      item.citekey = citekey.key;
    }

    if (!item.citationKey) {
      item.citationKey = citekey.key;
    }

    try {
      item.date = await getIssueDateFromCiteKey(citekey, database);
    } catch {
      // We don't particularly care about this
    }

    try {
      item.collections = await getCollectionFromCiteKey(citekey, database);
    } catch {
      // We don't particularly care about this
    }

    try {
      item.bibliography = await getBibFromCiteKey(citekey, database, cslStyle);
    } catch {
      item.bibliography = 'Error generating bibliography';
    }
  }

  if (analyzeReferencesState === true) {
    item.referenceTitles = await getReferenceTitles(item, skipUnavailableReferencesState)
  }

  if (item.notes) {
    for (const note of item.notes) {
      await processNote(citekey, note, importDate, database, cslStyle);
    }
  }

  if (item.attachments) {
    for (const attachment of item.attachments) {
      processAttachment(attachment);
    }
  }

  if (!skipRelations) {
    item.relations = await getRelations(
      item,
      item.libraryID,
      importDate,
      database,
      cslStyle
    );
  }
}

function generateHelpfulTemplateError(e: Error, template: string) {
  const message = e.message;

  try {
    if (message) {
      const match = message.match(/\[Line (\d+), Column (\d+)]/);

      if (match) {
        const lines = template.split(/\n/g);
        const line = lines[Number(match[1]) - 1];
        const indicator = ' '.repeat(Number(match[2]) - 1) + '^';

        return `${message}\n\n${line}\n${indicator}`;
      }
    }
  } catch {
    //
  }

  return message;
}

function errorToHelpfulNotification(
  e: Error,
  templatePath: string,
  template: string
) {
  new Notice(
    createFragment((f) => {
      f.createSpan({
        text: `Error parsing template "${templatePath}": `,
      });
      f.createEl('code', {
        text: generateHelpfulTemplateError(e, template),
      });
    }),
    10000
  );
}

function errorToHelpfulError(e: Error, templatePath: string, template: string) {
  return new Error(
    `Error parsing template "${templatePath}": ${generateHelpfulTemplateError(
      e,
      template
    )}`
  );
}

export async function renderTemplates(
  params: ExportToMarkdownParams,
  templateData: Record<any, any>,
  existingAnnotations: string,
  shouldThrow?: boolean
) {
  const { template, headerTemplate, annotationTemplate, footerTemplate } =
    await getTemplates(params);

  if (!template && !headerTemplate && !annotationTemplate && !footerTemplate) {
    throw new Error(
      `No templates found for export ${params.exportFormat.name}`
    );
  }

  let main = '';
  let hasPersist = false;

  if (template) {
    try {
      main = await renderTemplate(
        params.exportFormat.templatePath,
        template,
        templateData
      );
      hasPersist = PersistExtension.hasPersist(main);
    } catch (e) {
      if (shouldThrow) {
        throw errorToHelpfulError(
          e,
          params.exportFormat.templatePath,
          template
        );
      } else {
        errorToHelpfulNotification(
          e,
          params.exportFormat.templatePath,
          template
        );
        return false;
      }
    }

    return hasPersist ? appendExportDate(main) : main;
  }

  // Legacy templates
  let header = '';
  let annotations = '';
  let footer = '';

  try {
    header = headerTemplate
      ? await renderTemplate(
          params.exportFormat.headerTemplatePath,
          headerTemplate,
          templateData
        )
      : '';
  } catch (e) {
    if (shouldThrow) {
      throw errorToHelpfulError(
        e,
        params.exportFormat.headerTemplatePath,
        headerTemplate
      );
    } else {
      errorToHelpfulNotification(
        e,
        params.exportFormat.headerTemplatePath,
        headerTemplate
      );
      return false;
    }
  }

  try {
    annotations = annotationTemplate
      ? await renderTemplate(
          params.exportFormat.annotationTemplatePath,
          annotationTemplate,
          templateData
        )
      : '';
  } catch (e) {
    if (shouldThrow) {
      throw errorToHelpfulError(
        e,
        params.exportFormat.annotationTemplatePath,
        annotationTemplate
      );
    } else {
      errorToHelpfulNotification(
        e,
        params.exportFormat.annotationTemplatePath,
        annotationTemplate
      );
      return false;
    }
  }

  try {
    footer = footerTemplate
      ? await renderTemplate(
          params.exportFormat.footerTemplatePath,
          footerTemplate,
          templateData
        )
      : '';
  } catch (e) {
    if (shouldThrow) {
      throw errorToHelpfulError(
        e,
        params.exportFormat.footerTemplatePath,
        footerTemplate
      );
    } else {
      errorToHelpfulNotification(
        e,
        params.exportFormat.footerTemplatePath,
        footerTemplate
      );
      return false;
    }
  }

  const output: string[] = [];

  if (headerTemplate && header.trim()) {
    output.push(header);
  }

  const haveAnnotations =
    annotationTemplate && (existingAnnotations + annotations).trim();

  if (haveAnnotations) {
    output.push(wrapAnnotationTemplate(existingAnnotations + annotations));
  }

  if (footerTemplate && footer.trim()) {
    output.push(footer);
  }

  return haveAnnotations ? appendExportDate(output.join('')) : output.join('');
}

export function getATemplatePath({ exportFormat }: ExportToMarkdownParams) {
  return (
    exportFormat.templatePath ||
    exportFormat.headerTemplatePath ||
    exportFormat.annotationTemplatePath ||
    exportFormat.footerTemplatePath ||
    ''
  );
}

async function getAttachmentData(item: any, database: DatabaseWithPort) {
  let mappedAttachments: Record<string, any> = {};

  try {
    const citekey = getCiteKeyFromAny(item);
    if (citekey) {
      const fullAttachmentData = await getAttachmentsFromCiteKey(
        citekey,
        database
      );

      mappedAttachments = ((fullAttachmentData || []) as any[]).reduce<
        Record<string, any>
      >((col, a) => {
        if (a?.path) {
          col[a.path] = a;
        }
        return col;
      }, {});
    }
  } catch (e) {
    console.error(e);
  }

  return mappedAttachments;
}

async function getTemplateData(
  markdownPath: string,
  item: any,
  lastImportDate: moment.Moment
) {
  const firstPDF = item.attachments.find(
    (a: any) => a.path?.endsWith('.pdf') && a.annotations?.length
  );

  item.annotations = firstPDF?.annotations ?? [];
  item.lastImportDate = lastImportDate;
  item.lastExportDate = lastImportDate;
  item.isFirstImport = lastImportDate.valueOf() === 0;

  return await applyBasicTemplates(markdownPath, item);
}

export async function exportToMarkdown(
  params: ExportToMarkdownParams,
  explicitCiteKeys?: CiteKey[]
): Promise<string[]> {
  const importDate = moment();
  const { database, exportFormat, settings } = params;
  const sourcePath = getATemplatePath(params);
  const canExtract = doesEXEExist();

  const citeKeys = explicitCiteKeys
    ? explicitCiteKeys
    : await getCiteKeys(database);
  if (!citeKeys.length) return [];

  const libraryID = citeKeys[0].library;
  let itemData: any;
  try {
    itemData = await getItemJSONFromCiteKeys(citeKeys, database, libraryID);
  } catch (e) {
    return [];
  }

  // Variable to store the paths of the markdown files that will be created on import.
  // This is an array of an interface defined by a citekey and a path.
  // We first store the citekey in the order of the retrieved item data to save the order input by the user.
  // Further down below, when the Markdown file path has been sanitized, we associate the path to the key.
  const createdOrUpdatedMarkdownFiles: string[] = [];

  for (let i = 0, len = itemData.length; i < len; i++) {
    await processItem(itemData[i], importDate, database, exportFormat.cslStyle, false, settings.analyzeReferencesState, settings.skipUnavailableReferencesState);
  }

  const vaultRoot = getVaultRoot();
  const toRender: Map<
    string,
    {
      item: any;
      file: TFile;
      fileContent: string;
      lastImportDate: moment.Moment;
      existingAnnotations: string;
    }
  > = new Map();

  const queueRender = async (markdownPath: string, item: any) => {
    if (!toRender.has(markdownPath)) {
      const existingMarkdownFile = app.vault.getAbstractFileByPath(
        markdownPath
      ) as TFile;
      const existingMarkdown = existingMarkdownFile
        ? await app.vault.cachedRead(existingMarkdownFile as TFile)
        : '';
      const existingAnnotations = existingMarkdownFile
        ? getExistingAnnotations(existingMarkdown)
        : '';
      const lastImportDate = existingMarkdownFile
        ? getLastExport(existingMarkdown)
        : moment(0);

      toRender.set(markdownPath, {
        item,
        file: existingMarkdownFile,
        fileContent: existingMarkdown,
        lastImportDate,
        existingAnnotations,
      });
    }
  };

  const getMarkdownPath = async (pathTemplateData: any) => {
    return normalizePath(
      sanitizeFilePath(
        removeStartingSlash(
          await renderTemplate(
            sourcePath,
            exportFormat.outputPathTemplate,
            pathTemplateData
          )
        )
      )
    );
  };

  for (let i = 0, len = itemData.length; i < len; i++) {
    const item = itemData[i];
    const attachments = item.attachments as any[];
    const attachmentData = await getAttachmentData(item, database);

    if (!attachments.length) {
      const pathTemplateData = await applyBasicTemplates(sourcePath, {
        annotations: [],
        ...item,
      });
      const markdownPath = await getMarkdownPath(pathTemplateData);

      await queueRender(markdownPath, item);
      continue;
    }

    for (let j = 0, jLen = attachments.length; j < jLen; j++) {
      const attachment = attachments[j];
      const attachmentPath = attachment.path;
      const isPDF = attachmentPath?.endsWith('.pdf');

      const pathTemplateData = await applyBasicTemplates(sourcePath, {
        annotations: [],
        ...attachment,
        ...item,
      });

      const imageRelativePath = exportFormat.imageOutputPathTemplate
        ? normalizePath(
            sanitizeFilePath(
              removeStartingSlash(
                await renderTemplate(
                  sourcePath,
                  exportFormat.imageOutputPathTemplate,
                  pathTemplateData
                )
              )
            )
          )
        : '';

      const imageOutputPath = path.resolve(vaultRoot, imageRelativePath);

      const imageBaseName = exportFormat.imageBaseNameTemplate
        ? sanitizeFilePath(
            removeStartingSlash(
              await renderTemplate(
                sourcePath,
                exportFormat.imageBaseNameTemplate,
                pathTemplateData
              )
            )
          )
        : 'image';

      const markdownPath = await getMarkdownPath(pathTemplateData);

      let annots: any[] = [];

      if (isPDF) {
        attachmentData[attachmentPath]?.annotations?.forEach((annot: any) => {
          if (!annot.annotationPosition.rects?.length) return;

          annots.push(
            convertNativeAnnotation(
              annot,
              attachment,
              imageOutputPath,
              imageRelativePath,
              imageBaseName,
              true
            )
          );
        });
      }

      if (annots.length && settings.shouldConcat) {
        annots = concatAnnotations(annots);
      }

      if (isPDF && canExtract) {
        try {
          const res = await extractAnnotations(
            attachmentPath,
            {
              imageBaseName: imageBaseName,
              imageDPI: settings.pdfExportImageDPI,
              imageFormat: settings.pdfExportImageFormat,
              imageOutputPath: imageOutputPath,
              imageQuality: settings.pdfExportImageQuality,
              attemptOCR: settings.pdfExportImageOCR,
              ocrLang: settings.pdfExportImageOCRLang,
              tesseractPath: settings.pdfExportImageTesseractPath,
              tessDataDir: settings.pdfExportImageTessDataDir,
            },
            settings.exeOverridePath
          );

          let extracted = JSON.parse(res);

          for (const e of extracted) {
            processAnnotation(e, attachment, imageRelativePath);
          }

          if (settings.shouldConcat && extracted.length) {
            extracted = concatAnnotations(extracted);
          }

          annots.push(...extracted);
        } catch (e) {
          //
        }
      }

      if (annots.length) {
        attachment.annotations = annots;
      }

      await queueRender(markdownPath, item);
    }
  }

  for (const [markdownPath, data] of toRender.entries()) {
    try {
      const { existingAnnotations, file, fileContent, item, lastImportDate } =
        data;

      const templateData = await getTemplateData(
        markdownPath,
        item,
        lastImportDate
      );
      const rendered = await renderTemplates(
        params,
        PersistExtension.prepareTemplateData(templateData, fileContent),
        existingAnnotations
      );

      if (!rendered) continue;

      if (file) {
        await app.vault.modify(file, rendered);
      } else {
        await mkMDDir(markdownPath);
        await app.vault.create(markdownPath, rendered);
      }

      createdOrUpdatedMarkdownFiles.push(markdownPath);
    } catch (e) {
      new Notice(
        `Import failed for ${markdownPath}, check developer console for details`,
        7000
      );
      console.error(e);
    }
  }

  return createdOrUpdatedMarkdownFiles;
}

export async function renderCiteTemplate(params: RenderCiteTemplateParams) {
  const importDate = moment();
  const { database, format } = params;
  const citeKeys = await getCiteKeys(database);

  if (!citeKeys.length) return null;

  const libraryID = citeKeys[0].library;
  let itemData: any[];
  try {
    itemData = await getItemJSONFromCiteKeys(citeKeys, database, libraryID);
  } catch (e) {
    return null;
  }

  if (itemData.length === 0) {
    return null;
  }

  const output: string[] = [];

  for (let i = 0, len = itemData.length; i < len; i++) {
    await processItem(itemData[i], importDate, database, format.cslStyle);

    const attachments = (itemData[i].attachments as any[]) || [];
    const firstPDF = attachments.find((a) => !!a.path?.endsWith('.pdf'));

    const templateData = {
      attachment: firstPDF || attachments.length ? attachments[0] : null,
      ...itemData[i],
    };

    output.push(await renderTemplate('', format.template, templateData));
  }

  return output.join(' ');
}

function getAStyle(settings: ZoteroConnectorSettings) {
  const exportStyle = settings.exportFormats.find((f) => !!f.cslStyle);

  if (exportStyle) {
    return exportStyle.cslStyle;
  }

  const citeStyle = settings.citeFormats.find((f) => !!f.cslStyle);

  if (citeStyle) {
    return citeStyle.cslStyle;
  }
}

export async function dataExplorerPrompt(settings: ZoteroConnectorSettings) {
  const database = { database: settings.database, port: settings.port };
  const citeKeys = await getCiteKeys(database);
  const canExtract = doesEXEExist();

  if (!citeKeys.length) return null;

  const libraryID = citeKeys[0].library;
  let itemData: any;
  try {
    itemData = await getItemJSONFromCiteKeys(citeKeys, database, libraryID);
  } catch (e) {
    return null;
  }

  const importDate = moment();
  const style = getAStyle(settings);

  for (let i = 0, len = itemData.length; i < len; i++) {
    await processItem(itemData[i], importDate, database, style);
  }

  const vaultRoot = getVaultRoot();

  for (let i = 0, len = itemData.length; i < len; i++) {
    const item = itemData[i];
    const attachments = item.attachments;
    const attachmentData = await getAttachmentData(item, database);

    for (let j = 0, jLen = attachments.length; j < jLen; j++) {
      const attachment = attachments[j];
      const attachmentPath = attachment.path;
      if (!attachmentPath?.endsWith('.pdf')) continue;

      let annots: any[] = [];

      attachmentData[attachmentPath]?.annotations?.forEach((annot: any) => {
        if (!annot.annotationPosition.rects?.length) return;

        annots.push(
          convertNativeAnnotation(
            annot,
            attachments[j],
            path.join(vaultRoot, 'output_path'),
            'base_name',
            'output_path'
          )
        );
      });

      if (settings.shouldConcat && annots.length) {
        annots = concatAnnotations(annots);
      }

      if (canExtract) {
        try {
          const res = await extractAnnotations(
            attachmentPath,
            {
              noWrite: true,
              imageBaseName: 'base_name',
              imageDPI: settings.pdfExportImageDPI,
              imageFormat: settings.pdfExportImageFormat,
              imageOutputPath: path.join(vaultRoot, 'output_path'),
              imageQuality: settings.pdfExportImageQuality,
              attemptOCR: settings.pdfExportImageOCR,
              ocrLang: settings.pdfExportImageOCRLang,
              tesseractPath: settings.pdfExportImageTesseractPath,
              tessDataDir: settings.pdfExportImageTessDataDir,
            },
            settings.exeOverridePath
          );

          let extracted = JSON.parse(res);

          for (const e of extracted) {
            processAnnotation(e, attachments[j], 'output_path');
          }

          if (settings.shouldConcat && extracted.length) {
            extracted = concatAnnotations(extracted);
          }

          annots.push(...extracted);
        } catch (e) {
          return false;
        }
      }

      if (annots.length) {
        attachment.annotations = annots;
      }
    }
  }

  await Promise.all(
    itemData.map(async (data: any) => {
      await getTemplateData('', data, moment(0));
    })
  );

  return itemData;
}
