import { readFile } from "fs";
import { Notice, request } from "obsidian";
import { LoadingModal } from "src/bbt/LoadingModal";
import { parseString } from "xml2js";

async function isGrobidRunning(): Promise<boolean> {
  let response
  try {
    response = await request({
      method: 'GET',
      url: 'http://localhost:8070/api/isalive'
    })
  }
  catch {
    new Notice('GROBID is not running at http://localhost:8070')
    return false
  }
  if (response === 'false') {
    new Notice('GROBID is not running at http://localhost:8070')
    return false
  }
  return true
}
function getPath(item: any) {
  const attachments = item.attachments
  if (!attachments) {
    return
  }
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i]
    if (!attachment.path) {
      continue
    }
    const extension = attachment.path.split('.').last()
    if (extension === 'pdf') {
      return attachment.path
    }
  }
}
async function getFileBlob(path: string): Promise<Blob> {
  return new Promise<Blob>((resolve) => {
    readFile(path, (_error, data) => {
      const fileBlob = new Blob([data.buffer], { type: 'mutlipart/form-data' })
      resolve(fileBlob)
    })
  })
}
async function extractStructuredReferenceData(item: any): Promise<string> {
  if (!(await isGrobidRunning())) {
    return
  }
  const path = getPath(item)
  if (!path) {
    return
  }
  const fileBlob = await getFileBlob(path)
  const formData = new FormData()
  formData.append('input', fileBlob)
  return new Promise<string>((resolve) => {
    fetch('http://localhost:8070/api/processReferences', {
      method: 'POST',
      body: formData
    }).then((response) => {
      return response.text()
    }).then((data) => {
      resolve(data)
    })
  })
}
function parseReferencesXML(xml: string) {
  const titles: any[] = []
  parseString(xml, (_error, data) => {
    const references = data.TEI.text[0].back[0].div[0].listBibl[0].biblStruct
    for (const reference of references) {
      let title
      if (reference.analytic) {
        if (reference.analytic[0].title) {
          if (reference.analytic[0].title[0]._ && reference.analytic[0].title[0]._.length > 0) {
            title = reference.analytic[0].title[0]._
            titles.push(title)
          }
        }
      }
      if (!title && reference.monogr) {
        if (reference.monogr[0].title) {
          if (reference.monogr[0].title[0]._ && reference.monogr[0].title[0]._.length > 0) {
            title = reference.monogr[0].title[0]._
            titles.push(title)
          }
        }
      }
      if (!title) {
        titles.push('Not available')
      }
    }
  });
  return titles
}
export async function getReferenceTitles(item: any) {
  const modal = new LoadingModal(app, 'Analyzing references...');
  if (await isGrobidRunning()) {
    modal.open()
    const referenceXML = await extractStructuredReferenceData(item)
    const referenceTitles = parseReferencesXML(referenceXML)
    modal.close()
    return referenceTitles
  }
  modal.close()
}
