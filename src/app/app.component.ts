import { Component, ElementRef, ViewChild } from '@angular/core';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Sansations } from 'src/assets/Sansations';
import { VINCI } from 'src/assets/Vinci_Sans/vinci';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  public pipsziForm: FormGroup = this._fb.group({
    // 202510010100202710010100
    start: ['202602010100', [Validators.required]],
    end: ['202802010100', [Validators.required]],
    name: ['BUDPSH', [Validators.required]],
    sortbyStart: [2001, [Validators.required]], //incluseive
    sortbyEnd: [4000 , [Validators.required]], //incluseive
  });

  // BUDPSH201908011200202108011200419033840918781
  start: number = +this.pipsziForm.value.sortbyStart;
  end: number = +this.pipsziForm.value.sortbyEnd;
  i: number = this.start;
  name: string = this.pipsziForm.value.name;
  ervenyessegKezdete: string = this.pipsziForm.value.start;
  ervenyessegVege: string = this.pipsziForm.value.end;
  currcrc32: number = this.crc32(
    (this.i + this.dayOfTheYear(this.ervenyessegKezdete)).toString()
  );

  value = 'KEZDŐÉRTÉK, mind1 hogy mi csoda';

  @ViewChild('open') open!: ElementRef;

  constructor(private _fb: FormBuilder) {
    // const d= this.dayOfTheYear("20190801")
    // console.log(d);
    // console.log(this.crc32((41903 +d).toString()));
    // console.log(this.crc32((35035 +d).toString()));
    // console.log(this.crc32((45336 +d).toString()));
    // console.log(this.crc32((41919 +d).toString()));
  }

  //------------------------ Init-ek ------------------------

  ngOnInit(): void {
    this.pdfFontInit();
    this.generatorInit();

    // this.valami()
  }

  pdfFontInit(): void {
    // this.PDF.addFileToVFS('../assets/Sansation_Bold.ttf', Sansations.BOLD);
    // this.PDF.addFont(
    //   '../assets/Sansation_Bold.ttf',
    //   'Sansation_Bold',
    //   'normal'
    // );
    // this.PDF.addFileToVFS(
    //   '../assets/Sansation_Regular.ttf',
    //   Sansations.REGULAR
    // );
    // this.PDF.addFont(
    //   '../assets/Sansation_Regular.ttf',
    //   'Sansation_Regular',
    //   'normal'
    // );
    // this.PDF.addFileToVFS('../assets/Sansation_Light.ttf', Sansations.LIGHT);
    // this.PDF.addFont(
    //   '../assets/Sansation_Light.ttf',
    //   'Sansation_Light',
    //   'normal'
    // );
    this.PDF.addFileToVFS('../assets/Vinci_Sans/Vinci_Sans_Bold.ttf', VINCI.BOLD);
    this.PDF.addFont(
      '../assets/Vinci_Sans/Vinci_Sans_Bold.ttf',
      'Vinci_Sans_Bold',
      'normal'
    );
    this.PDF.addFileToVFS(
      '../assets/Vinci_Sans/Vinci_Sans_Regular.ttf',
      VINCI.REGULAR
    );
    this.PDF.addFont(
      '../assets/Vinci_Sans/Vinci_Sans_Regular.ttf',
      'Vinci_Sans_Regular',
      'normal'
    );
    this.PDF.addFileToVFS('../assets/Vinci_Sans/Vinci_Sans_Light.ttf', VINCI.LIGHT);
    this.PDF.addFont(
      '../assets/Vinci_Sans/Vinci_Sans_Light.ttf',
      'Vinci_Sans_Light',
      'normal'
    );
    this.PDF.addFileToVFS('../assets/pdf417.ttf', Sansations.PDF417);
    this.PDF.addFont('../assets/pdf417.ttf', 'pdf417', 'normal');
  }

  generatorInit() {
    this.start = +this.pipsziForm.value.sortbyStart;
    this.end = +this.pipsziForm.value.sortbyEnd;
    this.i = this.start;
    this.name = this.pipsziForm.value.name;
    this.ervenyessegKezdete = this.pipsziForm.value.start;
    this.ervenyessegVege = this.pipsziForm.value.end;

    this.currcrc32 = this.crc32(
      (this.i + this.dayOfTheYear(this.ervenyessegKezdete)).toString()
    );
  }
  //------------------------ Start/Pause button ------------------------

  private hasTimer: boolean = false;
  private timerId: any;
  startCalc() {
    if (this.hasTimer) {
      clearInterval(this.timerId);
      this.hasTimer = false;
      return;
    } else {
      this.hasTimer = true;
      this.timerId = setInterval(() => {
        this.open.nativeElement.click();
      }, 1000);
    }
  }
  //------------------------ üzleti logika ------------------------

  dayOfTheYear(stringDate: string): any {
    const sYear = stringDate.slice(0, 4);
    const sMonth = stringDate.slice(4, 6);
    const sDay = stringDate.slice(6, 8);
    const currentDate = sYear + '-' + sMonth + '-' + sDay;
    const now = new Date(currentDate);
    const start = new Date(new Date(currentDate).getFullYear(), 0, 0);
    const diff = now.valueOf() - start.valueOf();
    const oneDay = 1000 * 60 * 60 * 24;
    const day = Math.floor(diff / oneDay);
    return day;
  }

  calculateText(): string {
    this.currcrc32 = this.crc32(
      (this.i + this.dayOfTheYear(this.ervenyessegKezdete)).toString()
    );
    return (
      this.name +
      this.ervenyessegKezdete +
      this.ervenyessegVege +
      this.calculateNum(this.i) +
      this.currcrc32
    );
  }
  //------------------------ CRC 32 ------------------------

  crc32(r: any) {
    for (var a, o = [], c = 0; c < 256; c++) {
      a = c;
      for (var f = 0; f < 8; f++) a = 1 & a ? 3988292384 ^ (a >>> 1) : a >>> 1;
      o[c] = a;
    }
    for (var n = -1, t = 0; t < r.length; t++)
      n = (n >>> 8) ^ o[255 & (n ^ r.charCodeAt(t))];
    return (-1 ^ n) >>> 0;
  }

  //------------------------ PDF ------------------------

  FILEURI: any;
  // PDF = new jsPDF('l', 'mm', [101.6, 83]);
  // @ViewChild('code') code!: ElementRef;

  // rating: number = 101.6 / 1200;
  // fileHeight: number = 200 * this.rating;
  // fileWidth: number = 645 * this.rating;


  // PDF = new jsPDF('l', 'mm',[113.3, 73.3]);
  // @ViewChild('code') code!: ElementRef;
  // rating: number = 113.3 / 2523;
  // fileHeight: number = (390) * this.rating ;
  // fileWidth: number = (1160)  * this.rating ;

  PDF = new jsPDF('l', 'mm',[108.3, 78.3]);
  @ViewChild('code') code!: ElementRef;
  rating: number = 108.3 / 1279;
  fileHeight: number = (200) * this.rating ;
  fileWidth: number = (645)  * this.rating ;

  generateComplate() {
    // const canvas = document.createElement('canvas');
    // console.log(canvas.width);
    // this.fileWidth = canvas.width * this.fileHeight /  canvas.height;


    const caalculedtext = this.calculateText();
    if (this.i < this.start) {
      return;
    }
    if (this.i === this.start) {
      this.i++;
      this.value = caalculedtext;
      return;
    }
    console.log(this.name);
    console.log(this.ervenyessegKezdete);
    console.log(this.ervenyessegVege);
    console.log(this.i - 1);
    console.log(caalculedtext);

    // this.PDF.setFont('Sansation_Light');
    this.PDF.setFont('Vinci_Sans_Light');
    this.PDF.setTextColor(0, 0, 0);
    this.PDF.setFontSize(10.5);
    // this.PDF.text(
    //   (this.i - 1).toString(),
    //   this.rating * 390.535,
    //   this.rating * 535
    // );

    // this.PDF.text(
    //   (this.i - 1).toString(),
    //   this.rating * 327,   // ≈ 14.95
    //   this.rating * 1173   // ≈ 52.73
    // );
    const text = this.calculateNum(this.i - 1)
        this.PDF.text(
      text,
      this.rating * 181,
      this.rating * 651
    );
    // this.PDF.addImage(
    //   this.FILEURI,
    //   'png',
    //   this.rating * 155.57,
    //   this.rating * 570,
    //   this.fileWidth,
    //   this.fileHeight,
    //   undefined,
    //   'FAST'
    // );

    // x 1015 y 996
    // this.PDF.addImage(
    //   this.FILEURI,
    //   'png',
    //   this.rating * 1001,
    //   this.rating * 986,
    //   this.fileWidth,
    //   this.fileHeight,
    //   undefined,
    //   'FAST'
    // );
        this.PDF.addImage(
      this.FILEURI,
      'png',
      this.rating * 468,
      this.rating * 537,
      this.fileWidth,
      this.fileHeight,
      undefined,
      'FAST'
    );
    // this.PDF.addImage(
    //   this.FILEURI,
    //   'png',
    //   this.rating * 155.57,
    //   this.rating * 570,
    //   this.fileWidth,
    //   this.fileHeight
    // );

    if (this.i <= this.end) {
      this.PDF.addPage();
    }
    if (this.i === this.end + 1) {
      this.PDF.save('angular-demo.pdf');
    }
    this.i++;
    this.value = caalculedtext;
    this.code.nativeElement.click();
    // ez vmiért nem dobja vissza a labdát azért kellet a openPDF()-t triggerelni 1 secenként
  }
public pixelToMm = (px: number) => {
  const dpi = 300;

 return  px * 25.4 / dpi
};

calculateNum(num: number): string {
    return num < 10000 ? num.toString().padStart(5, '0') : num.toString();
  }

  public openPDF(): void {
    const caalculedtext = this.calculateText();
    // if (this.i <this.start) {
    //   this.code.nativeElement.click()
    //   this.i++;
    // }
    let DATA: any = document.getElementById('htmlData');
    html2canvas(DATA).then((canvas: any) => {
      // console.log(object);
      // this.fileWidth = canvas.width * this.fileHeight /  canvas.height;
      this.FILEURI = canvas.toDataURL('image/png');
      this.code.nativeElement.value = caalculedtext;
      this.code.nativeElement.click();
    });
  }
}

// const rating = 101.6/1200
// let fileHeight = 200*rating;
// let fileWidth =   canvas.width * fileHeight /  canvas.height;
// const FILEURI = canvas.toDataURL('image/JPEG');
// let PDF = new jsPDF('l', 'mm', [101.6,83]);
// // PDF.setFillColor("#FFFF00")
// for (let i = this.start; i <= this.end; i++) {
//   this.value=i.toString()
// // this.code.nativeElement.value=i.toString()
// this.code.nativeElement.click()
// PDF.text(i.toString(),rating*390,rating*535);
// PDF.addImage(FILEURI, 'JPEG', rating*155, rating*570, fileWidth, fileHeight);
// if (i<this.end) {
//   PDF.addPage()
// }
// }
// PDF.save('angular-demo.pdf');
